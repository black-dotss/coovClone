import { PublicKey } from "@solana/web3.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bounties, bountyClaims, bountySubmissions, evaluations } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { assertCandidateEligibleToClaimOnChain } from "@/lib/bounties/service";
import {
  BadRequestError,
  ConflictError,
  createApiHandler,
  ForbiddenError,
  NotFoundError,
  successResponse,
} from "@/lib/shared";
import {
  confirmSubmittedSignature,
  fetchOnChainClaimReceipt,
  fetchOnChainEscrow,
  getExplorerTxUrl,
  prepareClaimBountyTx,
} from "@/lib/solana";

const PrepareClaimSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  evaluationId: z.string().uuid(),
});

const ConfirmClaimSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  evaluationId: z.string().uuid(),
  txSignature: z.string().min(32).max(128),
});

async function assertEligibleClaimInput(params: {
  bountyId: string;
  userId: string;
  evaluationId: string;
  walletAddress: string;
}) {
  const [bounty] = await db
    .select()
    .from(bounties)
    .where(eq(bounties.id, params.bountyId))
    .limit(1);

  if (!bounty) {
    throw new NotFoundError("Bounty not found");
  }
  if (bounty.status !== "active") {
    throw new BadRequestError(`Bounty is ${bounty.status} and cannot be claimed.`);
  }

  const [evalRow] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.id, params.evaluationId))
    .limit(1);

  if (!evalRow) {
    throw new NotFoundError("Evaluation not found");
  }
  if (evalRow.ownerUserId !== params.userId) {
    throw new ForbiddenError("You do not own this evaluation");
  }
  if (evalRow.jobDescriptionId !== bounty.jobDescriptionId) {
    throw new BadRequestError("This evaluation was not run against the bounty role.");
  }
  if (evalRow.status !== "completed") {
    throw new BadRequestError("Evaluation must be completed before claiming.");
  }
  if (!evalRow.evalTxSignature) {
    throw new BadRequestError(
      "Anchor your evaluation proof on-chain first before claiming USDC."
    );
  }
  if (evalRow.candidateWallet && evalRow.candidateWallet !== params.walletAddress) {
    throw new BadRequestError(
      `Switch to wallet ${evalRow.candidateWallet} (the wallet used to anchor this evaluation).`
    );
  }

  await assertCandidateEligibleToClaimOnChain({
    bounty,
    evalRow,
    userId: params.userId,
    walletAddress: params.walletAddress,
  });

  return { bounty, evalRow };
}

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = PrepareClaimSchema.parse(body);

    let candidateWallet: string;
    try {
      candidateWallet = new PublicKey(parsed.walletAddress).toBase58();
    } catch {
      throw new BadRequestError("Invalid candidate Solana wallet address");
    }

    const { bounty, evalRow } = await assertEligibleClaimInput({
      bountyId: id,
      userId: session.user.id,
      evaluationId: parsed.evaluationId,
      walletAddress: candidateWallet,
    });

    const [existingClaim] = await db
      .select({ id: bountyClaims.id })
      .from(bountyClaims)
      .where(
        and(
          eq(bountyClaims.bountyId, bounty.id),
          eq(bountyClaims.candidateUserId, session.user.id)
        )
      )
      .limit(1);

    if (existingClaim) {
      throw new ConflictError("You have already claimed a payout from this bounty.");
    }

    const prepared = await prepareClaimBountyTx({
      candidateWallet,
      jobId: bounty.jobDescriptionId,
      evalId: evalRow.id,
    });

    return successResponse(prepared);
  }
);

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = ConfirmClaimSchema.parse(body);

    let candidateWallet: string;
    try {
      candidateWallet = new PublicKey(parsed.walletAddress).toBase58();
    } catch {
      throw new BadRequestError("Invalid candidate Solana wallet address");
    }

    const { bounty, evalRow } = await assertEligibleClaimInput({
      bountyId: id,
      userId: session.user.id,
      evaluationId: parsed.evaluationId,
      walletAddress: candidateWallet,
    });

    await confirmSubmittedSignature(parsed.txSignature);
    const [claimRes, escrowRes] = await Promise.all([
      fetchOnChainClaimReceipt(bounty.jobDescriptionId, candidateWallet),
      fetchOnChainEscrow(bounty.jobDescriptionId),
    ]);

    if (!claimRes.claim) {
      throw new BadRequestError(
        "Transaction confirmed, but BountyClaim PDA receipt was not found on-chain."
      );
    }

    const [existing] = await db
      .select()
      .from(bountyClaims)
      .where(
        and(
          eq(bountyClaims.bountyId, bounty.id),
          eq(bountyClaims.candidateWallet, candidateWallet)
        )
      )
      .limit(1);

    if (!existing) {
      await db.insert(bountyClaims).values({
        bountyId: bounty.id,
        candidateUserId: session.user.id,
        candidateWallet,
        evaluationId: evalRow.id,
        claimReceiptPda: claimRes.claimReceiptPda,
        claimTxSignature: parsed.txSignature,
        amountMicros: claimRes.claim.amountPaidMicros,
      });
    }

    const updatedClaimsCount = escrowRes.escrow?.claimsCount ?? bounty.claimsCount + 1;
    const isFilled =
      escrowRes.escrow?.isClosed || updatedClaimsCount >= bounty.maxWinners;

    await db
      .update(bounties)
      .set({
        claimsCount: updatedClaimsCount,
        status: isFilled ? "filled" : "active",
        updatedAt: new Date(),
      })
      .where(eq(bounties.id, bounty.id));

    await db
      .update(bountySubmissions)
      .set({
        candidateWallet,
        reviewStatus: "claimed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bountySubmissions.bountyId, bounty.id),
          eq(bountySubmissions.evaluationId, evalRow.id)
        )
      );

    return successResponse({
      confirmed: true,
      claimReceiptPda: claimRes.claimReceiptPda,
      amountPaidUsdc: Number(claimRes.claim.amountPaidMicros) / 1_000_000,
      txSignature: parsed.txSignature,
      txUrl: getExplorerTxUrl(parsed.txSignature),
      claimsCount: updatedClaimsCount,
    });
  }
);

import { PublicKey } from "@solana/web3.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getActiveRestriction, getBountySlotMetrics } from "@/lib/bounties/service";
import { db } from "@/lib/db";
import { bounties, bountySubmissions } from "@/lib/db/schema";
import {
  BadRequestError,
  createApiHandler,
  ForbiddenError,
  NotFoundError,
  successResponse,
} from "@/lib/shared";
import {
  confirmSubmittedSignature,
  fetchOnChainConvictionStake,
  getExplorerTxUrl,
  prepareRefundConvictionStakeTx,
} from "@/lib/solana";

const PrepareRefundStakeSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  submissionId: z.string().uuid().optional(),
});

const ConfirmRefundStakeSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  submissionId: z.string().uuid(),
  txSignature: z.string().min(32).max(128),
});

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = PrepareRefundStakeSchema.parse(body);

    let candidateWallet: string;
    try {
      candidateWallet = new PublicKey(parsed.walletAddress).toBase58();
    } catch {
      throw new BadRequestError("Invalid candidate Solana wallet address.");
    }

    const [bounty] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, id))
      .limit(1);

    if (!bounty) {
      throw new NotFoundError("Bounty not found.");
    }

    const restriction = await getActiveRestriction({
      bountyId: bounty.id,
      userId: session.user.id,
      walletAddress: candidateWallet,
    });
    if (restriction) {
      throw new ForbiddenError(
        `Fraudulent or restricted submissions forfeit their stake (${restriction.reason.replace(/_/g, " ")}).`
      );
    }

    const subs = await db
      .select()
      .from(bountySubmissions)
      .where(
        parsed.submissionId
          ? and(
              eq(bountySubmissions.id, parsed.submissionId),
              eq(bountySubmissions.bountyId, bounty.id),
              eq(bountySubmissions.candidateUserId, session.user.id)
            )
          : and(
              eq(bountySubmissions.bountyId, bounty.id),
              eq(bountySubmissions.candidateUserId, session.user.id)
            )
      )
      .limit(1);

    const sub = subs[0];
    if (!sub) {
      throw new NotFoundError("Submission record not found.");
    }
    if (
      sub.reviewStatus === "rejected" ||
      sub.reviewStatus === "blocked_fake" ||
      sub.reviewStatus === "blocked_duplicate"
    ) {
      throw new ForbiddenError("Slashed or rejected submissions cannot refund their stake.");
    }
    if (sub.stakeStatus !== "pending") {
      throw new BadRequestError(`Stake status is ${sub.stakeStatus} and cannot be refunded.`);
    }

    const metrics = await getBountySlotMetrics(bounty.id, bounty);
    const canRefund =
      sub.reviewStatus === "below_threshold" ||
      bounty.expiresAt.getTime() < Date.now() ||
      (sub.reviewStatus === "evaluating" && metrics.availableSlots <= 0);

    if (!canRefund) {
      throw new BadRequestError(
        "Active pending-review stakes remain locked until review completes or you score below threshold."
      );
    }

    const prepared = await prepareRefundConvictionStakeTx({
      candidateWallet,
      jobId: bounty.jobDescriptionId,
    });

    return successResponse({
      ...prepared,
      submissionId: sub.id,
      amountRefundedUsdc: Number(prepared.amountRefundedMicros) / 1_000_000,
    });
  }
);

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = ConfirmRefundStakeSchema.parse(body);

    let candidateWallet: string;
    try {
      candidateWallet = new PublicKey(parsed.walletAddress).toBase58();
    } catch {
      throw new BadRequestError("Invalid candidate Solana wallet address.");
    }

    const [bounty] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, id))
      .limit(1);
    if (!bounty) {
      throw new NotFoundError("Bounty not found.");
    }

    await confirmSubmittedSignature(parsed.txSignature);
    const stakeRes = await fetchOnChainConvictionStake(bounty.jobDescriptionId, candidateWallet);
    if (!stakeRes.stake || stakeRes.stake.status !== "refunded") {
      throw new BadRequestError(
        "Transaction confirmed, but ConvictionStake status is not refunded on-chain."
      );
    }

    await db
      .update(bountySubmissions)
      .set({
        stakeStatus: "refunded",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bountySubmissions.id, parsed.submissionId),
          eq(bountySubmissions.bountyId, bounty.id),
          eq(bountySubmissions.candidateUserId, session.user.id)
        )
      );

    return successResponse({
      refunded: true,
      amountRefundedUsdc: Number(stakeRes.stake.amountStakedMicros) / 1_000_000,
      txSignature: parsed.txSignature,
      txUrl: getExplorerTxUrl(parsed.txSignature),
    });
  }
);

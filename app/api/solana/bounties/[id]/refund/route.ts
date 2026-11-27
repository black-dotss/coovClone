import { PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bounties } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import {
  BadRequestError,
  createApiHandler,
  ForbiddenError,
  NotFoundError,
  successResponse,
} from "@/lib/shared";
import {
  confirmSubmittedSignature,
  fetchOnChainEscrow,
  getExplorerTxUrl,
  prepareWithdrawExpiredEscrowTx,
} from "@/lib/solana";

const PrepareRefundSchema = z.object({
  walletAddress: z.string().min(32).max(64),
});

const ConfirmRefundSchema = z.object({
  txSignature: z.string().min(32).max(128),
});

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = PrepareRefundSchema.parse(body);

    let recruiterWallet: string;
    try {
      recruiterWallet = new PublicKey(parsed.walletAddress).toBase58();
    } catch {
      throw new BadRequestError("Invalid recruiter Solana wallet address");
    }

    const [bounty] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, id))
      .limit(1);

    if (!bounty) {
      throw new NotFoundError("Bounty not found");
    }
    if (bounty.recruiterUserId !== session.user.id) {
      throw new ForbiddenError("Only the bounty creator can withdraw expired funds.");
    }

    const prepared = await prepareWithdrawExpiredEscrowTx({
      recruiterWallet,
      jobId: bounty.jobDescriptionId,
    });

    return successResponse(prepared);
  }
);

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = ConfirmRefundSchema.parse(body);

    const [bounty] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, id))
      .limit(1);

    if (!bounty) {
      throw new NotFoundError("Bounty not found");
    }
    if (bounty.recruiterUserId !== session.user.id) {
      throw new ForbiddenError("Only the bounty creator can confirm a refund.");
    }

    await confirmSubmittedSignature(parsed.txSignature);
    const escrowRes = await fetchOnChainEscrow(bounty.jobDescriptionId);
    if (escrowRes.escrow && !escrowRes.escrow.isClosed) {
      throw new BadRequestError(
        "Transaction confirmed, but on-chain BountyEscrow is still open."
      );
    }

    await db
      .update(bounties)
      .set({
        status: "refunded",
        refundTxSignature: parsed.txSignature,
        updatedAt: new Date(),
      })
      .where(eq(bounties.id, bounty.id));

    return successResponse({
      confirmed: true,
      status: "refunded",
      txSignature: parsed.txSignature,
      txUrl: getExplorerTxUrl(parsed.txSignature),
    });
  }
);

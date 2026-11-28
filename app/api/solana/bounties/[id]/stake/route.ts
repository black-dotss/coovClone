import { PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getActiveRestriction, getBountySlotMetrics } from "@/lib/bounties/service";
import { db } from "@/lib/db";
import { bounties } from "@/lib/db/schema";
import {
  BadRequestError,
  createApiHandler,
  ForbiddenError,
  NotFoundError,
  successResponse,
} from "@/lib/shared";
import { prepareSubmitWithConvictionStakeTx } from "@/lib/solana";

const PrepareStakeSchema = z.object({
  walletAddress: z.string().min(32).max(64),
});

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = PrepareStakeSchema.parse(body);

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
    if (bounty.status !== "active" || bounty.expiresAt.getTime() < Date.now()) {
      throw new BadRequestError("This bounty is no longer active.");
    }
    if (bounty.recruiterUserId === session.user.id) {
      throw new ForbiddenError("Bounty creators cannot stake against their own bounty.");
    }

    const restriction = await getActiveRestriction({
      bountyId: bounty.id,
      userId: session.user.id,
      walletAddress: candidateWallet,
    });
    if (restriction) {
      throw new ForbiddenError(
        `Restricted from this bounty (${restriction.reason.replace(/_/g, " ")}): ${restriction.details}`
      );
    }

    const metrics = await getBountySlotMetrics(bounty.id, bounty);
    if (metrics.availableSlots <= 0) {
      throw new BadRequestError("All winner slots for this bounty are currently filled or reserved.");
    }

    const prepared = await prepareSubmitWithConvictionStakeTx({
      candidateWallet,
      jobId: bounty.jobDescriptionId,
    });

    return successResponse({
      ...prepared,
      stakeUsdc: Number(prepared.stakeMicros) / 1_000_000,
    });
  }
);

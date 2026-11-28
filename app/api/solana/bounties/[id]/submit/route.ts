import { PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { syncEvaluationToBountySubmission } from "@/lib/bounties/service";
import { db } from "@/lib/db";
import { bounties, evaluations } from "@/lib/db/schema";
import {
  BadRequestError,
  createApiHandler,
  ForbiddenError,
  NotFoundError,
  successResponse,
} from "@/lib/shared";

const SubmitToBountySchema = z.object({
  evaluationId: z.string().uuid(),
  walletAddress: z.string().min(32).max(64).optional(),
  stakeTxSignature: z.string().min(32).max(128).optional(),
});

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = SubmitToBountySchema.parse(body);

    let walletAddress: string | null = null;
    if (parsed.walletAddress) {
      try {
        walletAddress = new PublicKey(parsed.walletAddress).toBase58();
      } catch {
        throw new BadRequestError("Invalid Solana wallet address");
      }
    }

    const [bounty] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, id))
      .limit(1);

    if (!bounty) {
      throw new NotFoundError("Bounty not found");
    }
    if (bounty.status !== "active" || bounty.expiresAt.getTime() < Date.now()) {
      throw new BadRequestError("This bounty is no longer active.");
    }

    const [evalRow] = await db
      .select()
      .from(evaluations)
      .where(eq(evaluations.id, parsed.evaluationId))
      .limit(1);

    if (!evalRow) {
      throw new NotFoundError("Evaluation not found");
    }
    if (evalRow.ownerUserId !== session.user.id) {
      throw new ForbiddenError("You do not own this evaluation.");
    }
    if (evalRow.jobDescriptionId !== bounty.jobDescriptionId) {
      throw new BadRequestError("Evaluation does not belong to this bounty.");
    }

    const res = await syncEvaluationToBountySubmission({
      evaluationId: evalRow.id,
      walletAddress: walletAddress ?? evalRow.candidateWallet,
      stakeTxSignature: parsed.stakeTxSignature,
      requireOnChainStake: true,
    });

    if (res?.restriction) {
      throw new ForbiddenError(
        `Restricted from this bounty (${res.restriction.reason.replace(/_/g, " ")}): ${res.restriction.details}`
      );
    }

    return successResponse({
      submission: res?.submission ?? null,
    });
  }
);

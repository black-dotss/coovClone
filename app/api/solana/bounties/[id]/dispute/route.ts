import { PublicKey } from "@solana/web3.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  auditEvents,
  bounties,
  bountyDisputes,
  bountySubmissions,
  evaluations,
} from "@/lib/db/schema";
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
  DISPUTE_MIN_SCORE,
  fetchOnChainDisputeTicket,
  fetchOnChainEscrow,
  fetchOnChainReputation,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  prepareOpenDisputeTx,
} from "@/lib/solana";

const PrepareDisputeSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  evaluationId: z.string().uuid().optional(),
});

const ConfirmDisputeSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  evaluationId: z.string().uuid().optional(),
  txSignature: z.string().min(32).max(128),
});

async function resolveRejectedCandidateContext(params: {
  bountyId: string;
  userId: string;
  walletAddress: string;
  evaluationId?: string;
}) {
  let candidateWallet: string;
  try {
    candidateWallet = new PublicKey(params.walletAddress).toBase58();
  } catch {
    throw new BadRequestError("Invalid candidate Solana wallet address.");
  }

  const [bounty] = await db
    .select()
    .from(bounties)
    .where(eq(bounties.id, params.bountyId))
    .limit(1);

  if (!bounty) {
    throw new NotFoundError("Bounty not found.");
  }

  const subRows = await db
    .select({
      sub: bountySubmissions,
      evalRow: evaluations,
    })
    .from(bountySubmissions)
    .innerJoin(evaluations, eq(bountySubmissions.evaluationId, evaluations.id))
    .where(
      and(
        eq(bountySubmissions.bountyId, params.bountyId),
        eq(bountySubmissions.candidateUserId, params.userId)
      )
    )
    .orderBy(desc(bountySubmissions.createdAt));

  const targetRow = params.evaluationId
    ? subRows.find((r) => r.sub.evaluationId === params.evaluationId)
    : subRows.find((r) => r.sub.reviewStatus === "rejected") ?? subRows[0];

  if (!targetRow) {
    throw new NotFoundError("No rejected submission found for this bounty.");
  }
  const { sub, evalRow } = targetRow;

  if (sub.reviewStatus !== "rejected") {
    throw new BadRequestError(
      `Only rejected submissions can open a Dispute Jury ticket (current status: ${sub.reviewStatus}).`
    );
  }
  if (sub.fakeDetectorStatus === "flagged") {
    throw new ForbiddenError(
      "Submissions flagged by the Fake Resume Detector cannot open a Dispute Jury ticket."
    );
  }
  const score = evalRow.overallScore ?? 0;
  if (score < DISPUTE_MIN_SCORE) {
    throw new ForbiddenError(
      `Your evaluation score (${score}/100) must be at least ${DISPUTE_MIN_SCORE}/100 to open a No-Chill Dispute Jury ticket.`
    );
  }
  if (!evalRow.evalTxSignature) {
    throw new BadRequestError(
      "Anchor your Evaluation Proof PDA on-chain first from your report before opening a Dispute Jury ticket."
    );
  }

  const [existingDispute] = await db
    .select()
    .from(bountyDisputes)
    .where(eq(bountyDisputes.submissionId, sub.id))
    .limit(1);

  return {
    bounty,
    sub,
    evalRow,
    candidateWallet,
    score,
    existingDispute: existingDispute ?? null,
  };
}

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id: bountyId } = await context.params;
    const body = await req.json();
    const parsed = PrepareDisputeSchema.parse(body);

    const { bounty, evalRow, candidateWallet, score, existingDispute } =
      await resolveRejectedCandidateContext({
        bountyId,
        userId: session.user.id,
        walletAddress: parsed.walletAddress,
        evaluationId: parsed.evaluationId,
      });

    if (existingDispute) {
      throw new ConflictError(
        `A Dispute Jury ticket (${existingDispute.disputeTicketPda}) already exists for this submission.`
      );
    }

    const repRes = await fetchOnChainReputation(candidateWallet).catch(() => null);
    if (repRes?.reputation && repRes.reputation.fraudFlags > 0) {
      throw new ForbiddenError(
        "Wallets with on-chain fraud flags cannot open a Dispute Jury ticket."
      );
    }

    const prepared = await prepareOpenDisputeTx({
      candidateWallet,
      jobId: bounty.jobDescriptionId,
      evalId: evalRow.id,
    });

    return successResponse({
      ...prepared,
      evaluationId: evalRow.id,
      evaluationScore: score,
    });
  }
);

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id: bountyId } = await context.params;
    const body = await req.json();
    const parsed = ConfirmDisputeSchema.parse(body);

    const { bounty, sub, evalRow, candidateWallet, score, existingDispute } =
      await resolveRejectedCandidateContext({
        bountyId,
        userId: session.user.id,
        walletAddress: parsed.walletAddress,
        evaluationId: parsed.evaluationId,
      });

    if (existingDispute) {
      return successResponse({
        confirmed: true,
        dispute: existingDispute,
      });
    }

    await confirmSubmittedSignature(parsed.txSignature);
    const [ticketRes, escrowRes] = await Promise.all([
      fetchOnChainDisputeTicket(bounty.jobDescriptionId, candidateWallet),
      fetchOnChainEscrow(bounty.jobDescriptionId),
    ]);

    if (!ticketRes.dispute) {
      throw new BadRequestError(
        "Transaction confirmed, but DisputeTicket PDA was not found on-chain."
      );
    }

    const [created] = await db
      .insert(bountyDisputes)
      .values({
        bountyId: bounty.id,
        submissionId: sub.id,
        evaluationId: evalRow.id,
        candidateUserId: session.user.id,
        candidateWallet,
        disputeTicketPda: ticketRes.disputeTicketPda,
        openTxSignature: parsed.txSignature,
        evaluationScore: ticketRes.dispute.evaluationScore || score,
        rejectionReason: sub.recruiterNotes ?? "Rejected by bounty publisher.",
        votesForCandidate: ticketRes.dispute.votesForCandidate,
        votesForRecruiter: ticketRes.dispute.votesForRecruiter,
        jurorWallets: ticketRes.dispute.jurors,
        jurorVotes: [],
        status: ticketRes.dispute.status,
        openedAt: new Date(ticketRes.dispute.openedAt * 1000),
      })
      .returning();

    const onChainOpenCount = escrowRes.escrow?.openDisputesCount;
    await db
      .update(bounties)
      .set({
        openDisputesCount:
          typeof onChainOpenCount === "number" && onChainOpenCount > 0
            ? onChainOpenCount
            : (bounty.openDisputesCount ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(bounties.id, bounty.id));

    try {
      await db.insert(auditEvents).values({
        userId: session.user.id,
        action: "bounty.dispute_opened",
        targetType: "bounty_dispute",
        targetId: created.id,
        metadata: {
          bountyId: bounty.id,
          disputeTicketPda: ticketRes.disputeTicketPda,
          txSignature: parsed.txSignature,
          evaluationScore: created.evaluationScore,
        },
      });
    } catch {}

    return successResponse({
      confirmed: true,
      dispute: created,
      disputeTicketPda: ticketRes.disputeTicketPda,
      disputeTicketUrl: getExplorerAddressUrl(ticketRes.disputeTicketPda),
      txUrl: getExplorerTxUrl(parsed.txSignature),
    });
  }
);

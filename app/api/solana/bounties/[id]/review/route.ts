import { PublicKey } from "@solana/web3.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  getBountyPublisherReviewWorkspace,
  reviewBountySubmissionDecision,
} from "@/lib/bounties/service";
import { db } from "@/lib/db";
import { bounties, bountySubmissions, evaluations } from "@/lib/db/schema";
import { DISPUTE_MIN_SCORE } from "@/lib/solana";
import {
  BadRequestError,
  createApiHandler,
  ForbiddenError,
  NotFoundError,
  successResponse,
} from "@/lib/shared";
import {
  computeScoutSplitMicros,
  confirmSubmittedSignature,
  fetchOnChainClaimReceipt,
  fetchOnChainConvictionStake,
  fetchOnChainEscrow,
  getExplorerTxUrl,
  prepareApproveAndPayoutTx,
  prepareSlashFraudStakeTx,
} from "@/lib/solana";

const ReviewActionSchema = z.object({
  submissionId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  recruiterNotes: z.string().max(2000).optional(),
  recruiterWallet: z.string().min(32).max(64).optional(),
});

const ConfirmReviewTxSchema = z.object({
  submissionId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  recruiterNotes: z.string().max(2000).optional(),
  recruiterWallet: z.string().min(32).max(64),
  txSignature: z.string().min(32).max(128),
});

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const workspace = await getBountyPublisherReviewWorkspace(id, session.user.id);
    return successResponse(workspace);
  }
);

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = ReviewActionSchema.parse(body);

    const [bounty] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, id))
      .limit(1);

    if (!bounty) {
      throw new NotFoundError("Bounty not found");
    }
    if (bounty.recruiterUserId !== session.user.id) {
      throw new ForbiddenError("Only the bounty publisher can review submissions.");
    }

    const [sub] = await db
      .select()
      .from(bountySubmissions)
      .where(
        and(
          eq(bountySubmissions.id, parsed.submissionId),
          eq(bountySubmissions.bountyId, id)
        )
      )
      .limit(1);

    if (!sub) {
      throw new NotFoundError("Bounty submission not found");
    }

    const [evalRow] = await db
      .select({ overallScore: evaluations.overallScore })
      .from(evaluations)
      .where(eq(evaluations.id, sub.evaluationId))
      .limit(1);

    // Check if this candidate holds an active Pending ConvictionStake PDA on-chain
    let hasPendingOnChainStake = sub.stakeStatus === "pending";
    if (!hasPendingOnChainStake && sub.candidateWallet) {
      try {
        const onChainStake = await fetchOnChainConvictionStake(
          bounty.jobDescriptionId,
          sub.candidateWallet
        );
        if (onChainStake.stake?.status === "pending") {
          hasPendingOnChainStake = true;
        }
      } catch {
        // Fallback to DB state if RPC temporarily unavailable
      }
    }

    const isDisputeEligibleScore =
      (evalRow?.overallScore ?? 0) >= DISPUTE_MIN_SCORE &&
      sub.fakeDetectorStatus !== "flagged";

    // When rejecting a dispute-eligible (>= 90, non-flagged) candidate, hold their ConvictionStake
    // in Pending escrow so a 2-of-3 Jury Dispute can cleanly refund + pay OR slash on consensus.
    if (parsed.action === "reject" && hasPendingOnChainStake && isDisputeEligibleScore) {
      const updated = await reviewBountySubmissionDecision({
        bountyId: id,
        submissionId: parsed.submissionId,
        recruiterUserId: session.user.id,
        action: "reject",
        recruiterNotes: parsed.recruiterNotes,
      });

      return successResponse({
        requiresSignature: false,
        disputeEligibleHold: true,
        submission: updated,
        payoutUnlocked: false,
      });
    }

    if (hasPendingOnChainStake && sub.candidateWallet) {
      if (!parsed.recruiterWallet) {
        throw new BadRequestError(
          parsed.action === "approve"
            ? "Connect your publisher Solana wallet to execute on-chain approve_and_payout."
            : "Connect your publisher Solana wallet to execute on-chain slash_fraud_stake."
        );
      }
      let recruiterWallet: string;
      try {
        recruiterWallet = new PublicKey(parsed.recruiterWallet).toBase58();
      } catch {
        throw new BadRequestError("Invalid recruiter Solana wallet address.");
      }

      if (parsed.action === "approve") {
        const prepared = await prepareApproveAndPayoutTx({
          payerWallet: recruiterWallet,
          candidateWallet: sub.candidateWallet,
          jobId: bounty.jobDescriptionId,
          evalId: sub.evaluationId,
          oracleCosign: false,
        });
        return successResponse({
          requiresSignature: true,
          action: "approve" as const,
          submissionId: sub.id,
          ...prepared,
        });
      }

      const prepared = await prepareSlashFraudStakeTx({
        authorityWallet: recruiterWallet,
        candidateWallet: sub.candidateWallet,
        jobId: bounty.jobDescriptionId,
        reasonCode: 3,
      });
      return successResponse({
        requiresSignature: true,
        action: "reject" as const,
        submissionId: sub.id,
        ...prepared,
      });
    }

    // Fallback for legacy pre-stake submissions
    const updated = await reviewBountySubmissionDecision({
      bountyId: id,
      submissionId: parsed.submissionId,
      recruiterUserId: session.user.id,
      action: parsed.action,
      recruiterNotes: parsed.recruiterNotes,
    });

    return successResponse({
      requiresSignature: false,
      submission: updated,
      payoutUnlocked: updated.reviewStatus === "approved",
    });
  }
);

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = ConfirmReviewTxSchema.parse(body);

    const [bounty] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, id))
      .limit(1);
    if (!bounty) {
      throw new NotFoundError("Bounty not found");
    }
    if (bounty.recruiterUserId !== session.user.id) {
      throw new ForbiddenError("Only the bounty publisher can confirm review transactions.");
    }

    const [sub] = await db
      .select()
      .from(bountySubmissions)
      .where(
        and(
          eq(bountySubmissions.id, parsed.submissionId),
          eq(bountySubmissions.bountyId, id)
        )
      )
      .limit(1);
    if (!sub || !sub.candidateWallet) {
      throw new NotFoundError("Staked submission record not found.");
    }

    await confirmSubmittedSignature(parsed.txSignature);
    const [escrowRes, stakeRes, claimRes] = await Promise.all([
      fetchOnChainEscrow(bounty.jobDescriptionId),
      fetchOnChainConvictionStake(bounty.jobDescriptionId, sub.candidateWallet),
      parsed.action === "approve"
        ? fetchOnChainClaimReceipt(bounty.jobDescriptionId, sub.candidateWallet)
        : Promise.resolve({ claimReceiptPda: "", claim: null }),
    ]);

    if (parsed.action === "approve") {
      if (!claimRes.claim || stakeRes.stake?.status !== "approved") {
        throw new BadRequestError(
          "Transaction confirmed, but approve_and_payout state was not updated on-chain."
        );
      }

      const paidMicros = BigInt(claimRes.claim.amountPaidMicros);
      const referrerWallet = stakeRes.stake?.referrer ?? sub.referrerWallet ?? null;
      const { candidateRewardMicros, scoutCutMicros } = computeScoutSplitMicros(
        bounty.rewardPerWinnerMicros,
        Boolean(referrerWallet)
      );
      const stakeMicros = BigInt(stakeRes.stake.amountStakedMicros);
      const bonusMicros =
        paidMicros > candidateRewardMicros + stakeMicros
          ? paidMicros - candidateRewardMicros - stakeMicros
          : BigInt(0);

      const updated = await reviewBountySubmissionDecision({
        bountyId: id,
        submissionId: sub.id,
        recruiterUserId: session.user.id,
        action: "approve",
        recruiterNotes: parsed.recruiterNotes,
        payoutTxSignature: parsed.txSignature,
        claimReceiptPda: claimRes.claimReceiptPda,
        amountPaidMicros: paidMicros.toString(),
        bonusPaidMicros: bonusMicros.toString(),
        referrerWallet,
        scoutCutMicros: scoutCutMicros.toString(),
        claimsCount: escrowRes.escrow?.claimsCount ?? bounty.claimsCount + 1,
        slashedPoolMicros:
          escrowRes.escrow?.slashedPoolAmountMicros ?? bounty.slashedPoolMicros,
        isClosed: Boolean(escrowRes.escrow?.isClosed),
      });

      return successResponse({
        confirmed: true,
        action: "approve" as const,
        submission: updated,
        totalPaidUsdc: Number(paidMicros) / 1_000_000,
        bonusPaidUsdc: Number(bonusMicros) / 1_000_000,
        scoutPaidUsdc: Number(scoutCutMicros) / 1_000_000,
        referrerWallet,
        txSignature: parsed.txSignature,
        txUrl: getExplorerTxUrl(parsed.txSignature),
      });
    }

    if (stakeRes.stake?.status !== "slashed") {
      throw new BadRequestError(
        "Transaction confirmed, but ConvictionStake PDA is not marked Slashed on-chain."
      );
    }

    const updated = await reviewBountySubmissionDecision({
      bountyId: id,
      submissionId: sub.id,
      recruiterUserId: session.user.id,
      action: "reject",
      recruiterNotes: parsed.recruiterNotes,
      slashTxSignature: parsed.txSignature,
      slashedPoolMicros:
        escrowRes.escrow?.slashedPoolAmountMicros ?? bounty.slashedPoolMicros,
    });

    return successResponse({
      confirmed: true,
      action: "reject" as const,
      submission: updated,
      slashedAmountUsdc: Number(stakeRes.stake.amountStakedMicros) / 1_000_000,
      newSlashedPoolUsdc:
        Number(escrowRes.escrow?.slashedPoolAmountMicros ?? bounty.slashedPoolMicros) /
        1_000_000,
      txSignature: parsed.txSignature,
      txUrl: getExplorerTxUrl(parsed.txSignature),
    });
  }
);

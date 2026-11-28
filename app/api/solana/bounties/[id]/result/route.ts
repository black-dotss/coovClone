import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  computeStakeAndBonusMetrics,
  formatRemainingDuration,
  getActiveRestriction,
  getBountySlotMetrics,
  RESERVED_SUBMISSION_STATUSES,
  syncEvaluationToBountySubmission,
} from "@/lib/bounties/service";
import { db } from "@/lib/db";
import {
  bounties,
  bountyClaims,
  bountySubmissions,
  evaluations,
} from "@/lib/db/schema";
import {
  createApiHandler,
  ForbiddenError,
  NotFoundError,
  successResponse,
} from "@/lib/shared";
import { getExplorerTxUrl, getSolanaCluster } from "@/lib/solana";

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id: bountyId } = await context.params;
    const url = new URL(req.url);
    const evalId = url.searchParams.get("evalId")?.trim() || null;

    const [bounty] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, bountyId))
      .limit(1);

    if (!bounty) {
      throw new NotFoundError("Bounty not found");
    }

    // Locate requested evaluation (or user's latest evaluation for this bounty)
    let evalRow: typeof evaluations.$inferSelect | undefined;
    if (evalId) {
      const [found] = await db
        .select()
        .from(evaluations)
        .where(eq(evaluations.id, evalId))
        .limit(1);
      if (!found) {
        throw new NotFoundError("Evaluation not found");
      }
      if (found.ownerUserId !== session.user.id) {
        throw new ForbiddenError("You do not have access to this evaluation.");
      }
      evalRow = found;
    } else {
      const [latest] = await db
        .select()
        .from(evaluations)
        .where(
          and(
            eq(evaluations.ownerUserId, session.user.id),
            eq(evaluations.jobDescriptionId, bounty.jobDescriptionId)
          )
        )
        .limit(1);
      evalRow = latest;
    }

    const earlyStakeMetrics = computeStakeAndBonusMetrics(bounty);

    if (!evalRow) {
      return NextResponse.json(
        {
          success: true,
          data: {
            bounty: {
              id: bounty.id,
              title: bounty.title,
              company: bounty.company,
              companyLogoUrl: bounty.companyLogoUrl,
              minScore: bounty.minScore,
              minStreak: bounty.minStreak ?? 0,
              maxWinners: bounty.maxWinners,
              rewardPerWinnerUsdc: Number(bounty.rewardPerWinnerMicros) / 1_000_000,
              candidate90Usdc: earlyStakeMetrics.candidate90Usdc,
              scout10Usdc: earlyStakeMetrics.scout10Usdc,
              stakeBps: earlyStakeMetrics.stakeBps,
              stakePercent: earlyStakeMetrics.stakePercent,
              stakePerCandidateUsdc: earlyStakeMetrics.stakePerCandidateUsdc,
              slashedPoolUsdc: earlyStakeMetrics.slashedPoolUsdc,
              proRataBonusUsdc: earlyStakeMetrics.proRataBonusUsdc,
              expiresAt: bounty.expiresAt.toISOString(),
            },
            evaluation: null,
            submission: null,
            restriction: null,
            spotSecured: null,
            metrics: await getBountySlotMetrics(bounty.id, bounty),
            cluster: getSolanaCluster(),
          },
        },
        { status: 200 }
      );
    }

    // Ensure submission state is synchronized when evaluation is completed
    if (evalRow.status === "completed") {
      await syncEvaluationToBountySubmission({ evaluationId: evalRow.id });
    }

    const [subRows, claimRows, reservedRows, restriction, metrics] = await Promise.all([
      db
        .select()
        .from(bountySubmissions)
        .where(
          and(
            eq(bountySubmissions.bountyId, bounty.id),
            eq(bountySubmissions.evaluationId, evalRow.id)
          )
        )
        .limit(1),
      db
        .select({
          candidateUserId: bountyClaims.candidateUserId,
          claimTxSignature: bountyClaims.claimTxSignature,
          amountMicros: bountyClaims.amountMicros,
          createdAt: bountyClaims.createdAt,
        })
        .from(bountyClaims)
        .where(eq(bountyClaims.bountyId, bounty.id))
        .orderBy(asc(bountyClaims.createdAt)),
      db
        .select({
          id: bountySubmissions.id,
          evaluationId: bountySubmissions.evaluationId,
          candidateUserId: bountySubmissions.candidateUserId,
          reviewStatus: bountySubmissions.reviewStatus,
          slotReservedAt: bountySubmissions.slotReservedAt,
          createdAt: bountySubmissions.createdAt,
        })
        .from(bountySubmissions)
        .where(
          and(
            eq(bountySubmissions.bountyId, bounty.id),
            inArray(bountySubmissions.reviewStatus, [...RESERVED_SUBMISSION_STATUSES])
          )
        )
        .orderBy(asc(bountySubmissions.slotReservedAt), asc(bountySubmissions.createdAt)),
      getActiveRestriction({
        bountyId: bounty.id,
        userId: session.user.id,
        walletAddress: evalRow.candidateWallet,
      }),
      getBountySlotMetrics(bounty.id, bounty),
    ]);

    const submission = subRows[0] ?? null;
    const myClaim = claimRows.find((c) => c.candidateUserId === session.user.id) ?? null;

    let spotSecured: number | null = null;
    if (myClaim) {
      const idx = claimRows.findIndex((c) => c.candidateUserId === session.user.id);
      spotSecured = idx >= 0 ? idx + 1 : 1;
    } else if (
      submission &&
      (submission.reviewStatus === "pending_review" ||
        submission.reviewStatus === "approved" ||
        submission.reviewStatus === "claimed")
    ) {
      const reservedIdx = reservedRows.findIndex((r) => r.evaluationId === evalRow.id);
      if (reservedIdx >= 0) {
        spotSecured = Math.min(bounty.maxWinners, claimRows.length + reservedIdx + 1);
      }
    }

    const nowMs = Date.now();
    const deadlineMs = submission?.reviewDeadlineAt
      ? submission.reviewDeadlineAt.getTime()
      : null;

    return successResponse({
      cluster: getSolanaCluster(),
      bounty: {
        id: bounty.id,
        title: bounty.title,
        company: bounty.company,
        companyLogoUrl: bounty.companyLogoUrl,
        minScore: bounty.minScore,
        minStreak: bounty.minStreak ?? 0,
        maxWinners: bounty.maxWinners,
        rewardPerWinnerUsdc: Number(bounty.rewardPerWinnerMicros) / 1_000_000,
        candidate90Usdc: earlyStakeMetrics.candidate90Usdc,
        scout10Usdc: earlyStakeMetrics.scout10Usdc,
        stakeBps: earlyStakeMetrics.stakeBps,
        stakePercent: earlyStakeMetrics.stakePercent,
        stakePerCandidateUsdc: earlyStakeMetrics.stakePerCandidateUsdc,
        slashedPoolUsdc: earlyStakeMetrics.slashedPoolUsdc,
        proRataBonusUsdc: earlyStakeMetrics.proRataBonusUsdc,
        expiresAt: bounty.expiresAt.toISOString(),
      },
      evaluation: {
        id: evalRow.id,
        status: evalRow.status,
        overallScore: evalRow.overallScore,
        verdict: evalRow.verdict,
        evalPdaAddress: evalRow.evalPdaAddress,
        evalTxSignature: evalRow.evalTxSignature,
        evalTxUrl: evalRow.evalTxSignature ? getExplorerTxUrl(evalRow.evalTxSignature) : null,
      },
      submission: submission
        ? {
            id: submission.id,
            reviewStatus: submission.reviewStatus,
            fakeDetectorStatus: submission.fakeDetectorStatus,
            fakeDetectorScore: submission.fakeDetectorScore,
            recruiterNotes: submission.recruiterNotes,
            stakePdaAddress: submission.stakePdaAddress,
            stakeStatus: submission.stakeStatus,
            isZeroStakeVip: submission.isZeroStakeVip,
            referrerWallet: submission.referrerWallet,
            scoutCutUsdc: submission.scoutCutMicros
              ? Number(submission.scoutCutMicros) / 1_000_000
              : 0,
            stakeAmountUsdc: submission.stakeAmountMicros
              ? Number(submission.stakeAmountMicros) / 1_000_000
              : 0,
            bonusPaidUsdc: submission.bonusPaidMicros
              ? Number(submission.bonusPaidMicros) / 1_000_000
              : 0,
            remainingReviewLabel:
              deadlineMs && nowMs < deadlineMs
                ? formatRemainingDuration(deadlineMs, nowMs)
                : deadlineMs !== null && submission.reviewStatus === "pending_review"
                ? "Deadline expired (Auto-claim ready)"
                : null,
          }
        : null,
      restriction: restriction
        ? {
            reason: restriction.reason,
            details: restriction.details,
          }
        : null,
      claim: myClaim
        ? {
            txSignature: myClaim.claimTxSignature,
            txUrl: getExplorerTxUrl(myClaim.claimTxSignature),
          }
        : null,
      spotSecured,
      metrics,
    });
  }
);

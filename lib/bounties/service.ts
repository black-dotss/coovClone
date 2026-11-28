import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentRuns,
  auditEvents,
  bounties,
  bountyRestrictions,
  bountySubmissions,
  cvVersions,
  evaluations,
  jobDescriptions,
  reports,
  userProfiles,
  users,
} from "@/lib/db/schema";
import type { LLMProvider } from "@/lib/ai/providers/types";
import {
  computeExactShingleJaccard,
  computeNormalizedResumeHash,
  DUPLICATE_SIMILARITY_THRESHOLD,
  estimateMinHashSimilarity,
  runFakeResumeDetectorAgent,
  type FakeResumeDetectorReport,
} from "./fraud-detector";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

export const BOUNTY_REVIEW_WINDOW_HOURS = 24;
export const BOUNTY_REVIEW_WINDOW_MS = BOUNTY_REVIEW_WINDOW_HOURS * 60 * 60 * 1000;

export const RESERVED_SUBMISSION_STATUSES = ["pending_review", "approved"] as const;

export type RestrictionReason =
  | "duplicate_resume"
  | "fake_resume_detected"
  | "recruiter_rejected";

export interface BountySlotMetrics {
  maxWinners: number;
  claimsCount: number;
  reservedCount: number;
  pendingReviewCount: number;
  approvedCount: number;
  occupiedSlots: number;
  availableSlots: number;
}

async function recordBountyAudit(params: {
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditEvents).values({
      userId: params.userId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata ?? {},
    });
  } catch {
    // Non-fatal audit logging failure
  }
}

export function formatRemainingDuration(targetMs: number, nowMs = Date.now()): string {
  const diff = Math.max(0, targetMs - nowMs);
  const totalMinutes = Math.ceil(diff / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export async function findBountyByJobDescriptionId(jobDescriptionId: string) {
  try {
    const [row] = await db
      .select()
      .from(bounties)
      .where(eq(bounties.jobDescriptionId, jobDescriptionId))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function getActiveRestriction(params: {
  bountyId: string;
  userId?: string | null;
  walletAddress?: string | null;
  resumeHash?: string | null;
}) {
  const conditions = [];
  if (params.userId) {
    conditions.push(eq(bountyRestrictions.userId, params.userId));
  }
  if (params.walletAddress) {
    conditions.push(eq(bountyRestrictions.walletAddress, params.walletAddress));
  }
  if (params.resumeHash) {
    conditions.push(eq(bountyRestrictions.resumeHash, params.resumeHash));
  }
  if (conditions.length === 0) return null;

  try {
    const [restriction] = await db
      .select()
      .from(bountyRestrictions)
      .where(and(eq(bountyRestrictions.bountyId, params.bountyId), or(...conditions)))
      .orderBy(desc(bountyRestrictions.createdAt))
      .limit(1);
    return restriction ?? null;
  } catch {
    return null;
  }
}

export async function recordBountyRestriction(params: {
  bountyId: string;
  jobDescriptionId: string;
  userId?: string | null;
  walletAddress?: string | null;
  resumeHash?: string | null;
  reason: RestrictionReason;
  details: string;
  createdByUserId: string;
}) {
  const existing = await getActiveRestriction({
    bountyId: params.bountyId,
    userId: params.userId,
    walletAddress: params.walletAddress,
    resumeHash: params.resumeHash,
  });

  if (existing) {
    // Enrich missing identifiers if a banned user returned with a new userId/wallet/hash
    const updates: Partial<typeof bountyRestrictions.$inferInsert> = {};
    if (!existing.userId && params.userId) updates.userId = params.userId;
    if (!existing.walletAddress && params.walletAddress) {
      updates.walletAddress = params.walletAddress;
    }
    if (!existing.resumeHash && params.resumeHash) {
      updates.resumeHash = params.resumeHash;
    }
    if (Object.keys(updates).length > 0) {
      await db
        .update(bountyRestrictions)
        .set(updates)
        .where(eq(bountyRestrictions.id, existing.id));
    }
    return existing;
  }

  const [inserted] = await db
    .insert(bountyRestrictions)
    .values({
      bountyId: params.bountyId,
      jobDescriptionId: params.jobDescriptionId,
      userId: params.userId ?? null,
      walletAddress: params.walletAddress ?? null,
      resumeHash: params.resumeHash ?? null,
      reason: params.reason,
      details: params.details.slice(0, 1000),
      createdByUserId: params.createdByUserId,
    })
    .returning();

  await recordBountyAudit({
    userId: params.createdByUserId,
    action: `bounty.restricted.${params.reason}`,
    targetType: "bounty",
    targetId: params.bountyId,
    metadata: {
      userId: params.userId,
      walletAddress: params.walletAddress,
      resumeHash: params.resumeHash,
      details: params.details.slice(0, 500),
    },
  });

  return inserted;
}

export async function detectDuplicateResumeOnBounty(params: {
  bountyId: string;
  candidateUserId: string;
  walletAddress?: string | null;
  resumeHash: string;
  fingerprint: number[];
  cvText: string;
  excludeEvaluationId?: string;
}): Promise<{
  isDuplicate: boolean;
  similarity: number;
  matchedSubmissionId?: string;
  matchedUserId?: string;
}> {
  const existingRows = await db
    .select({
      id: bountySubmissions.id,
      candidateUserId: bountySubmissions.candidateUserId,
      candidateWallet: bountySubmissions.candidateWallet,
      evaluationId: bountySubmissions.evaluationId,
      resumeHash: bountySubmissions.resumeHash,
      resumeFingerprint: bountySubmissions.resumeFingerprint,
      reviewStatus: bountySubmissions.reviewStatus,
      extractedText: cvVersions.extractedText,
    })
    .from(bountySubmissions)
    .innerJoin(cvVersions, eq(bountySubmissions.cvVersionId, cvVersions.id))
    .where(
      params.excludeEvaluationId
        ? and(
            eq(bountySubmissions.bountyId, params.bountyId),
            ne(bountySubmissions.evaluationId, params.excludeEvaluationId)
          )
        : eq(bountySubmissions.bountyId, params.bountyId)
    );

  for (const row of existingRows) {
    const isExactHashMatch = row.resumeHash === params.resumeHash;
    const isSameOwner = row.candidateUserId === params.candidateUserId;
    const isSameWallet =
      Boolean(params.walletAddress) &&
      Boolean(row.candidateWallet) &&
      row.candidateWallet === params.walletAddress;

    if (isExactHashMatch) {
      return {
        isDuplicate: true,
        similarity: 1,
        matchedSubmissionId: row.id,
        matchedUserId: row.candidateUserId,
      };
    }

    const approxSim = estimateMinHashSimilarity(
      params.fingerprint,
      Array.isArray(row.resumeFingerprint) ? row.resumeFingerprint : []
    );

    if (approxSim >= 0.6 || !isSameOwner || !isSameWallet) {
      const exactJaccard = computeExactShingleJaccard(params.cvText, row.extractedText);
      const effectiveSim = Math.max(exactJaccard, approxSim * 0.9);
      if (exactJaccard >= DUPLICATE_SIMILARITY_THRESHOLD) {
        return {
          isDuplicate: true,
          similarity: Math.round(effectiveSim * 100) / 100,
          matchedSubmissionId: row.id,
          matchedUserId: row.candidateUserId,
        };
      }
    }
  }

  return { isDuplicate: false, similarity: 0 };
}

/**
 * Runs Duplicate/Near-Identical Hash Gate and Fake Resume Detector Agent BEFORE
 * creating/queuing a bounty evaluation or allowing entry.
 */
export async function validatePreBountySubmission(params: {
  jobDescriptionId: string;
  ownerUserId: string;
  cvVersionId: string;
  cvText: string;
  walletAddress?: string | null;
  provider?: LLMProvider;
  forceLlm?: boolean;
}): Promise<{
  bounty: typeof bounties.$inferSelect;
  resumeHash: string;
  fingerprint: number[];
  detectorReport: FakeResumeDetectorReport;
  candidateWallet: string | null;
} | null> {
  const bounty = await findBountyByJobDescriptionId(params.jobDescriptionId);
  if (!bounty) return null;

  if (bounty.status !== "active" || bounty.expiresAt.getTime() < Date.now()) {
    throw new BadRequestError("This bounty is no longer accepting submissions.");
  }

  let candidateWallet = params.walletAddress ?? null;
  if (!candidateWallet) {
    try {
      const [profile] = await db
        .select({ walletAddress: userProfiles.walletAddress })
        .from(userProfiles)
        .where(eq(userProfiles.userId, params.ownerUserId))
        .limit(1);
      candidateWallet = profile?.walletAddress ?? null;
    } catch {
      // Optional lookup
    }
  }

  const { resumeHash, fingerprint } = await computeNormalizedResumeHash(params.cvText);

  const restriction = await getActiveRestriction({
    bountyId: bounty.id,
    userId: params.ownerUserId,
    walletAddress: candidateWallet,
    resumeHash,
  });

  if (restriction) {
    // Propagate identifiers if banned user returned via a secondary account/wallet/hash
    await recordBountyRestriction({
      bountyId: bounty.id,
      jobDescriptionId: bounty.jobDescriptionId,
      userId: params.ownerUserId,
      walletAddress: candidateWallet,
      resumeHash,
      reason: restriction.reason as RestrictionReason,
      details: restriction.details,
      createdByUserId: "system",
    });
    throw new ForbiddenError(
      `Restricted from this bounty (${restriction.reason.replace(/_/g, " ")}): ${restriction.details}`
    );
  }

  const dup = await detectDuplicateResumeOnBounty({
    bountyId: bounty.id,
    candidateUserId: params.ownerUserId,
    walletAddress: candidateWallet,
    resumeHash,
    fingerprint,
    cvText: params.cvText,
  });

  if (dup.isDuplicate) {
    const pct = Math.round(dup.similarity * 100);
    const details =
      dup.similarity >= 1
        ? `Identical normalized resume SHA-256 (${resumeHash.slice(0, 12)}...) already submitted on this bounty.`
        : `Near-identical resume content (${pct}% shingle overlap) matched an earlier submission on this bounty.`;

    await recordBountyRestriction({
      bountyId: bounty.id,
      jobDescriptionId: bounty.jobDescriptionId,
      userId: params.ownerUserId,
      walletAddress: candidateWallet,
      resumeHash,
      reason: "duplicate_resume",
      details,
      createdByUserId: "system",
    });

    throw new ForbiddenError(
      `Duplicate or near-identical resume detected (${pct}% match). You are permanently restricted from this bounty.`
    );
  }

  const [jd] = await db
    .select({ rawText: jobDescriptions.rawText })
    .from(jobDescriptions)
    .where(eq(jobDescriptions.id, bounty.jobDescriptionId))
    .limit(1);

  const detectorReport = await runFakeResumeDetectorAgent({
    cvText: params.cvText,
    jdText: jd?.rawText ?? "",
    bountyTitle: bounty.title,
    provider: params.provider,
    forceLlm: params.forceLlm,
  });

  if (detectorReport.isFlagged) {
    const details = `Fake Resume Detector (${detectorReport.verdict}, risk ${detectorReport.riskScore}/100): ${detectorReport.summary}`;
    await recordBountyRestriction({
      bountyId: bounty.id,
      jobDescriptionId: bounty.jobDescriptionId,
      userId: params.ownerUserId,
      walletAddress: candidateWallet,
      resumeHash,
      reason: "fake_resume_detected",
      details,
      createdByUserId: "system",
    });

    throw new ForbiddenError(
      `Fake Resume Detector blocked this bounty submission: ${detectorReport.summary}`
    );
  }

  return {
    bounty,
    resumeHash,
    fingerprint,
    detectorReport,
    candidateWallet,
  };
}

export async function getBountySlotMetrics(bountyId: string, bountyRow?: typeof bounties.$inferSelect): Promise<BountySlotMetrics> {
  const bounty =
    bountyRow ??
    (
      await db
        .select()
        .from(bounties)
        .where(eq(bounties.id, bountyId))
        .limit(1)
    )[0];

  if (!bounty) {
    throw new NotFoundError("Bounty not found");
  }

  const activeReservations = await db
    .select({ reviewStatus: bountySubmissions.reviewStatus })
    .from(bountySubmissions)
    .where(
      and(
        eq(bountySubmissions.bountyId, bounty.id),
        inArray(bountySubmissions.reviewStatus, [...RESERVED_SUBMISSION_STATUSES])
      )
    );

  const pendingReviewCount = activeReservations.filter(
    (r) => r.reviewStatus === "pending_review"
  ).length;
  const approvedCount = activeReservations.filter(
    (r) => r.reviewStatus === "approved"
  ).length;
  const reservedCount = activeReservations.length;
  const occupiedSlots = bounty.claimsCount + reservedCount;
  const availableSlots = Math.max(0, bounty.maxWinners - occupiedSlots);

  return {
    maxWinners: bounty.maxWinners,
    claimsCount: bounty.claimsCount,
    reservedCount,
    pendingReviewCount,
    approvedCount,
    occupiedSlots,
    availableSlots,
  };
}

/**
 * Persists an initial submission row or synchronizes a completed evaluation into
 * an optimistic 48h `pending_review` slot reservation when `score >= min_score`.
 */
export async function syncEvaluationToBountySubmission(params: {
  evaluationId: string;
  walletAddress?: string | null;
  provider?: LLMProvider;
  forceLlm?: boolean;
}) {
  try {
    const [evalRow] = await db
      .select()
      .from(evaluations)
      .where(eq(evaluations.id, params.evaluationId))
      .limit(1);

    if (!evalRow) return null;

    const bounty = await findBountyByJobDescriptionId(evalRow.jobDescriptionId);
    if (!bounty) return null;

    const candidateWallet =
      params.walletAddress ?? evalRow.candidateWallet ?? null;

    const [cvRow] = await db
      .select({ extractedText: cvVersions.extractedText })
      .from(cvVersions)
      .where(eq(cvVersions.id, evalRow.cvVersionId))
      .limit(1);

    const cvText = cvRow?.extractedText ?? "";
    const { resumeHash, fingerprint } = await computeNormalizedResumeHash(cvText);

    const [existing] = await db
      .select()
      .from(bountySubmissions)
      .where(
        and(
          eq(bountySubmissions.bountyId, bounty.id),
          eq(bountySubmissions.evaluationId, evalRow.id)
        )
      )
      .limit(1);

    // Always re-check restrictions against userId, candidateWallet, and resumeHash
    const restriction = await getActiveRestriction({
      bountyId: bounty.id,
      userId: evalRow.ownerUserId,
      walletAddress: candidateWallet,
      resumeHash,
    });

    if (restriction) {
      const blockedStatus =
        restriction.reason === "duplicate_resume"
          ? "blocked_duplicate"
          : restriction.reason === "fake_resume_detected"
          ? "blocked_fake"
          : "rejected";

      if (existing) {
        const [updated] = await db
          .update(bountySubmissions)
          .set({
            candidateWallet: candidateWallet ?? existing.candidateWallet,
            reviewStatus: blockedStatus,
            recruiterNotes: existing.recruiterNotes ?? restriction.details,
            updatedAt: new Date(),
          })
          .where(eq(bountySubmissions.id, existing.id))
          .returning();
        return { submission: updated, restriction, bounty };
      }

      const [inserted] = await db
        .insert(bountySubmissions)
        .values({
          bountyId: bounty.id,
          jobDescriptionId: bounty.jobDescriptionId,
          candidateUserId: evalRow.ownerUserId,
          candidateWallet,
          evaluationId: evalRow.id,
          cvVersionId: evalRow.cvVersionId,
          resumeHash,
          resumeFingerprint: fingerprint,
          fakeDetectorStatus:
            restriction.reason === "fake_resume_detected" ? "flagged" : "passed",
          fakeDetectorScore:
            restriction.reason === "fake_resume_detected" ? 90 : 0,
          reviewStatus: blockedStatus,
          recruiterNotes: restriction.details,
        })
        .returning();
      return { submission: inserted, restriction, bounty };
    }

    let detectorStatus = existing?.fakeDetectorStatus ?? "pending";
    let detectorScore = existing?.fakeDetectorScore ?? null;
    let detectorReport =
      (existing?.fakeDetectorReport as Record<string, unknown> | null) ?? null;

    if (!existing) {
      // Legacy or pre-existing evaluation entering bounty: enforce duplicate + Fake Detector now!
      const dup = await detectDuplicateResumeOnBounty({
        bountyId: bounty.id,
        candidateUserId: evalRow.ownerUserId,
        walletAddress: candidateWallet,
        resumeHash,
        fingerprint,
        cvText,
        excludeEvaluationId: evalRow.id,
      });

      if (dup.isDuplicate) {
        const details = `Duplicate or near-identical resume (${Math.round(dup.similarity * 100)}% similarity) detected before bounty entry.`;
        const createdRestriction = await recordBountyRestriction({
          bountyId: bounty.id,
          jobDescriptionId: bounty.jobDescriptionId,
          userId: evalRow.ownerUserId,
          walletAddress: candidateWallet,
          resumeHash,
          reason: "duplicate_resume",
          details,
          createdByUserId: "system",
        });
        const [blocked] = await db
          .insert(bountySubmissions)
          .values({
            bountyId: bounty.id,
            jobDescriptionId: bounty.jobDescriptionId,
            candidateUserId: evalRow.ownerUserId,
            candidateWallet,
            evaluationId: evalRow.id,
            cvVersionId: evalRow.cvVersionId,
            resumeHash,
            resumeFingerprint: fingerprint,
            fakeDetectorStatus: "passed",
            reviewStatus: "blocked_duplicate",
            recruiterNotes: details,
          })
          .returning();
        return { submission: blocked, restriction: createdRestriction, bounty };
      }

      const [jd] = await db
        .select({ rawText: jobDescriptions.rawText })
        .from(jobDescriptions)
        .where(eq(jobDescriptions.id, bounty.jobDescriptionId))
        .limit(1);

      const report = await runFakeResumeDetectorAgent({
        cvText,
        jdText: jd?.rawText ?? "",
        bountyTitle: bounty.title,
        provider: params.provider,
        forceLlm: params.forceLlm,
      });

      detectorStatus = report.isFlagged ? "flagged" : "passed";
      detectorScore = report.riskScore;
      detectorReport = report as unknown as Record<string, unknown>;

      if (report.isFlagged) {
        const details = `Fake Resume Detector flagged submission (${report.riskScore}/100): ${report.summary}`;
        const createdRestriction = await recordBountyRestriction({
          bountyId: bounty.id,
          jobDescriptionId: bounty.jobDescriptionId,
          userId: evalRow.ownerUserId,
          walletAddress: candidateWallet,
          resumeHash,
          reason: "fake_resume_detected",
          details,
          createdByUserId: "system",
        });
        const [blocked] = await db
          .insert(bountySubmissions)
          .values({
            bountyId: bounty.id,
            jobDescriptionId: bounty.jobDescriptionId,
            candidateUserId: evalRow.ownerUserId,
            candidateWallet,
            evaluationId: evalRow.id,
            cvVersionId: evalRow.cvVersionId,
            resumeHash,
            resumeFingerprint: fingerprint,
            fakeDetectorStatus: "flagged",
            fakeDetectorScore: report.riskScore,
            fakeDetectorReport: detectorReport,
            reviewStatus: "blocked_fake",
            recruiterNotes: details,
          })
          .returning();
        return { submission: blocked, restriction: createdRestriction, bounty };
      }
    }

    // Determine review status and slot reservation
    let nextStatus = existing?.reviewStatus ?? "evaluating";
    let slotReservedAt = existing?.slotReservedAt ?? null;
    let reviewDeadlineAt = existing?.reviewDeadlineAt ?? null;

    const isTerminalOrActive =
      existing &&
      ["pending_review", "approved", "claimed", "rejected", "blocked_duplicate", "blocked_fake"].includes(
        existing.reviewStatus
      );

    if (!isTerminalOrActive && evalRow.status === "completed") {
      const score = evalRow.overallScore ?? 0;
      if (score < bounty.minScore) {
        nextStatus = "below_threshold";
      } else {
        const metrics = await getBountySlotMetrics(bounty.id, bounty);
        if (metrics.availableSlots > 0) {
          const now = new Date();
          slotReservedAt = existing?.slotReservedAt ?? now;
          reviewDeadlineAt =
            existing?.reviewDeadlineAt ?? new Date(slotReservedAt.getTime() + BOUNTY_REVIEW_WINDOW_MS);
          nextStatus = "pending_review";
        } else {
          // Waitlist state when all slots are currently claimed/reserved
          nextStatus = "evaluating";
        }
      }
    }

    if (existing) {
      const [updated] = await db
        .update(bountySubmissions)
        .set({
          candidateWallet: candidateWallet ?? existing.candidateWallet,
          fakeDetectorStatus: detectorStatus,
          fakeDetectorScore: detectorScore,
          fakeDetectorReport: detectorReport,
          reviewStatus: nextStatus,
          slotReservedAt,
          reviewDeadlineAt,
          updatedAt: new Date(),
        })
        .where(eq(bountySubmissions.id, existing.id))
        .returning();
      return { submission: updated, restriction: null, bounty };
    }

    const [created] = await db
      .insert(bountySubmissions)
      .values({
        bountyId: bounty.id,
        jobDescriptionId: bounty.jobDescriptionId,
        candidateUserId: evalRow.ownerUserId,
        candidateWallet,
        evaluationId: evalRow.id,
        cvVersionId: evalRow.cvVersionId,
        resumeHash,
        resumeFingerprint: fingerprint,
        fakeDetectorStatus: detectorStatus,
        fakeDetectorScore: detectorScore,
        fakeDetectorReport: detectorReport,
        reviewStatus: nextStatus,
        slotReservedAt,
        reviewDeadlineAt,
      })
      .returning();

    return { submission: created, restriction: null, bounty };
  } catch (err) {
    logger.warn("Could not sync evaluation to bounty submission", {
      evaluationId: params.evaluationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function persistInitialBountySubmission(params: {
  bounty: typeof bounties.$inferSelect;
  candidateUserId: string;
  candidateWallet: string | null;
  evaluationId: string;
  cvVersionId: string;
  resumeHash: string;
  fingerprint: number[];
  detectorReport: FakeResumeDetectorReport;
}) {
  try {
    await db
      .insert(bountySubmissions)
      .values({
        bountyId: params.bounty.id,
        jobDescriptionId: params.bounty.jobDescriptionId,
        candidateUserId: params.candidateUserId,
        candidateWallet: params.candidateWallet,
        evaluationId: params.evaluationId,
        cvVersionId: params.cvVersionId,
        resumeHash: params.resumeHash,
        resumeFingerprint: params.fingerprint,
        fakeDetectorStatus: "passed",
        fakeDetectorScore: params.detectorReport.riskScore,
        fakeDetectorReport: params.detectorReport as unknown as Record<string, unknown>,
        reviewStatus: "evaluating",
      })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn("Could not persist initial bounty submission record", {
      evaluationId: params.evaluationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Enforces anti-fraud gates AND optimistic review / 48h deadline auto-claim rules
 * immediately before building or recording an on-chain `claim_bounty` transaction.
 */
export async function assertCandidateEligibleToClaimOnChain(params: {
  bounty: typeof bounties.$inferSelect;
  evalRow: typeof evaluations.$inferSelect;
  userId: string;
  walletAddress: string;
}) {
  const synced = await syncEvaluationToBountySubmission({
    evaluationId: params.evalRow.id,
    walletAddress: params.walletAddress,
  });

  if (!synced) {
    throw new BadRequestError("Could not verify bounty submission state.");
  }

  if (synced.restriction) {
    throw new ForbiddenError(
      `Restricted from claiming on this bounty: ${synced.restriction.details}`
    );
  }

  const sub = synced.submission;
  if (!sub) {
    throw new BadRequestError("Submission record not found for this bounty.");
  }

  if (sub.reviewStatus === "blocked_duplicate") {
    throw new ForbiddenError(
      "Duplicate or near-identical resume detected. Payout claiming is permanently blocked."
    );
  }
  if (sub.reviewStatus === "blocked_fake") {
    throw new ForbiddenError(
      "Fake Resume Detector flagged this submission. Payout claiming is permanently blocked."
    );
  }
  if (sub.reviewStatus === "rejected") {
    throw new ForbiddenError(
      sub.recruiterNotes
        ? `Submission rejected by bounty publisher: ${sub.recruiterNotes}`
        : "Submission was rejected and permanently restricted by the bounty publisher."
    );
  }
  if (sub.reviewStatus === "claimed") {
    throw new ConflictError("You have already claimed this bounty payout.");
  }
  if (sub.reviewStatus === "below_threshold") {
    throw new BadRequestError(
      `Your score (${params.evalRow.overallScore ?? 0}/100) is below the bounty minimum (${params.bounty.minScore}/100).`
    );
  }
  if (sub.reviewStatus === "evaluating") {
    throw new BadRequestError(
      "All winner slots for this bounty are currently reserved or claimed."
    );
  }

  if (sub.reviewStatus === "pending_review") {
    const nowMs = Date.now();
    const deadlineMs = sub.reviewDeadlineAt
      ? sub.reviewDeadlineAt.getTime()
      : nowMs + BOUNTY_REVIEW_WINDOW_MS;

    if (nowMs < deadlineMs) {
      const remaining = formatRemainingDuration(deadlineMs, nowMs);
      throw new BadRequestError(
        `Your winner slot is reserved in pending_review. Awaiting recruiter approval or auto-claim unlock in ${remaining} (24h window).`
      );
    }

    return { submission: sub, unlockReason: "deadline_expired" as const };
  }

  if (sub.reviewStatus === "approved") {
    return { submission: sub, unlockReason: "recruiter_approved" as const };
  }

  throw new BadRequestError(`Unsupported submission status: ${sub.reviewStatus}`);
}

/**
 * Fetches full publisher review workspace data including full CV text,
 * 6-agent outputs, Fake Detector report, red flags, and restrictions.
 */
export async function getBountyPublisherReviewWorkspace(
  bountyId: string,
  requestingUserId: string
) {
  const [bountyRow] = await db
    .select({
      bounty: bounties,
      rawText: jobDescriptions.rawText,
    })
    .from(bounties)
    .innerJoin(jobDescriptions, eq(bounties.jobDescriptionId, jobDescriptions.id))
    .where(eq(bounties.id, bountyId))
    .limit(1);

  if (!bountyRow) {
    throw new NotFoundError("Bounty not found");
  }

  if (bountyRow.bounty.recruiterUserId !== requestingUserId) {
    throw new ForbiddenError("Only the bounty publisher can access the review panel.");
  }

  const slotMetrics = await getBountySlotMetrics(bountyId, bountyRow.bounty);

  const rawSubmissions = await db
    .select({
      submission: bountySubmissions,
      candidateName: users.name,
      candidateEmail: users.email,
      cvText: cvVersions.extractedText,
      overallScore: evaluations.overallScore,
      verdict: evaluations.verdict,
      evalTxSignature: evaluations.evalTxSignature,
      evalPdaAddress: evaluations.evalPdaAddress,
      canonicalReportHash: evaluations.canonicalReportHash,
      structuredReport: reports.structuredReport,
    })
    .from(bountySubmissions)
    .innerJoin(users, eq(bountySubmissions.candidateUserId, users.id))
    .innerJoin(cvVersions, eq(bountySubmissions.cvVersionId, cvVersions.id))
    .innerJoin(evaluations, eq(bountySubmissions.evaluationId, evaluations.id))
    .leftJoin(reports, eq(evaluations.id, reports.evaluationId))
    .where(eq(bountySubmissions.bountyId, bountyId))
    .orderBy(desc(bountySubmissions.createdAt));

  const submissionIds = rawSubmissions.map((r) => r.submission.evaluationId);
  const allRuns =
    submissionIds.length > 0
      ? await db
          .select({
            evaluationId: agentRuns.evaluationId,
            agentRole: agentRuns.agentRole,
            scoreContribution: agentRuns.scoreContribution,
            structuredResult: agentRuns.structuredResult,
          })
          .from(agentRuns)
          .where(inArray(agentRuns.evaluationId, submissionIds))
      : [];

  const restrictions = await db
    .select()
    .from(bountyRestrictions)
    .where(eq(bountyRestrictions.bountyId, bountyId))
    .orderBy(desc(bountyRestrictions.createdAt));

  const nowMs = Date.now();
  const submissions = rawSubmissions.map((row) => {
    const deadlineMs = row.submission.reviewDeadlineAt
      ? row.submission.reviewDeadlineAt.getTime()
      : null;
    const isReviewExpired = Boolean(
      row.submission.reviewStatus === "pending_review" &&
        deadlineMs !== null &&
        nowMs >= deadlineMs
    );

    return {
      ...row.submission,
      candidateName: row.candidateName,
      candidateEmail: row.candidateEmail,
      cvText: row.cvText,
      overallScore: row.overallScore,
      verdict: row.verdict,
      evalTxSignature: row.evalTxSignature,
      evalPdaAddress: row.evalPdaAddress,
      canonicalReportHash: row.canonicalReportHash,
      structuredReport: row.structuredReport,
      agentRuns: allRuns.filter((r) => r.evaluationId === row.submission.evaluationId),
      isReviewExpired,
      remainingReviewLabel:
        deadlineMs && nowMs < deadlineMs
          ? formatRemainingDuration(deadlineMs, nowMs)
          : isReviewExpired
          ? "Deadline expired (Auto-claim ready)"
          : null,
    };
  });

  return {
    bounty: {
      ...bountyRow.bounty,
      rawText: bountyRow.rawText,
      rewardPerWinnerUsdc: Number(bountyRow.bounty.rewardPerWinnerMicros) / 1_000_000,
      totalPoolUsdc:
        (Number(bountyRow.bounty.rewardPerWinnerMicros) * bountyRow.bounty.maxWinners) /
        1_000_000,
    },
    slotMetrics,
    submissions,
    restrictions,
  };
}

export async function reviewBountySubmissionDecision(params: {
  bountyId: string;
  submissionId: string;
  recruiterUserId: string;
  action: "approve" | "reject";
  recruiterNotes?: string;
}) {
  const [bounty] = await db
    .select()
    .from(bounties)
    .where(eq(bounties.id, params.bountyId))
    .limit(1);

  if (!bounty) {
    throw new NotFoundError("Bounty not found");
  }
  if (bounty.recruiterUserId !== params.recruiterUserId) {
    throw new ForbiddenError("Only the bounty publisher can review submissions.");
  }

  const [sub] = await db
    .select()
    .from(bountySubmissions)
    .where(
      and(
        eq(bountySubmissions.id, params.submissionId),
        eq(bountySubmissions.bountyId, params.bountyId)
      )
    )
    .limit(1);

  if (!sub) {
    throw new NotFoundError("Bounty submission not found");
  }
  if (sub.reviewStatus === "claimed") {
    throw new ConflictError("This payout has already been claimed on-chain.");
  }

  const trimmedNotes = params.recruiterNotes?.trim() || null;
  const now = new Date();

  if (params.action === "approve") {
    if (!["pending_review", "approved"].includes(sub.reviewStatus)) {
      throw new BadRequestError(
        `Only submissions in pending_review can be approved (current status: ${sub.reviewStatus}).`
      );
    }

    const [updated] = await db
      .update(bountySubmissions)
      .set({
        reviewStatus: "approved",
        reviewedAt: now,
        reviewedByUserId: params.recruiterUserId,
        ...(trimmedNotes ? { recruiterNotes: trimmedNotes } : {}),
        updatedAt: now,
      })
      .where(eq(bountySubmissions.id, sub.id))
      .returning();

    await recordBountyAudit({
      userId: params.recruiterUserId,
      action: "bounty.submission_approved",
      targetType: "bounty_submission",
      targetId: sub.id,
      metadata: { bountyId: bounty.id, notes: trimmedNotes },
    });

    return updated;
  }

  // Reject / Flag: free reserved slot & permanently restrict candidate/wallet/resumeHash
  const rejectDetails =
    trimmedNotes || "Flagged and rejected by bounty publisher during candidate review.";

  const [updated] = await db
    .update(bountySubmissions)
    .set({
      reviewStatus: "rejected",
      reviewedAt: now,
      reviewedByUserId: params.recruiterUserId,
      recruiterNotes: rejectDetails,
      updatedAt: now,
    })
    .where(eq(bountySubmissions.id, sub.id))
    .returning();

  await recordBountyRestriction({
    bountyId: bounty.id,
    jobDescriptionId: bounty.jobDescriptionId,
    userId: sub.candidateUserId,
    walletAddress: sub.candidateWallet,
    resumeHash: sub.resumeHash,
    reason: "recruiter_rejected",
    details: rejectDetails,
    createdByUserId: params.recruiterUserId,
  });

  await recordBountyAudit({
    userId: params.recruiterUserId,
    action: "bounty.submission_rejected",
    targetType: "bounty_submission",
    targetId: sub.id,
    metadata: { bountyId: bounty.id, details: rejectDetails },
  });

  return updated;
}

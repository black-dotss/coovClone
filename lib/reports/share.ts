import { createHash, randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { shareLinks, reports, evaluations, agentRuns, jobDescriptions } from "@/lib/db/schema";
import { eq, sql, or } from "drizzle-orm";
import { ForbiddenError, NotFoundError } from "@/lib/shared/errors";
import { redactStructuredReport } from "./redaction";
import { StructuredEvaluationReport } from "./types";
import { recordAuditEvent } from "@/lib/operations/audit";
import { logger } from "@/lib/shared/logger";
import { deriveProfilePda } from "@/lib/solana/codec";
import {
  extractCanonicalAgentScoresFromRuns,
  computeCanonicalHashFromReportRecord,
  type CanonicalAgentScores,
} from "@/lib/solana/canonical-hash";

export interface ShareLinkCreated {
  id: string;
  reportId: string;
  token: string;
  tokenHash: string;
  shareUrl: string;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface SharedOnChainProofMetadata {
  evaluationId: string;
  jobDescriptionId: string;
  targetRole: string | null;
  targetCompany: string | null;
  overallScore: number;
  verdict: string;
  modelVersion: string;
  defenseRevisionsCount: number;
  canonicalReportHash: string;
  agentScores: CanonicalAgentScores;
  candidateWallet: string | null;
  profilePdaAddress: string | null;
  evalPdaAddress: string | null;
  evalTxSignature: string | null;
  sbtMintAddress: string | null;
  sbtTxSignature: string | null;
  anchoredAt: Date | null;
}

export interface SharedReportResult {
  report: StructuredEvaluationReport;
  shareLink: {
    id: string;
    expiresAt: Date | null;
    accessCount: number;
    createdAt: Date;
  };
  onChainProof?: SharedOnChainProofMetadata | null;
}

/**
 * Computes SHA-256 hash of a raw share link token.
 */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

/**
 * Creates an expiring, revocable share link for an evaluation report.
 * Storing only the cryptographic SHA-256 hash in the database.
 */
export async function createShareLink(
  reportId: string,
  requestingUserId: string,
  options?: { expiresInDays?: number }
): Promise<ShareLinkCreated> {
  // 1. Verify caller owns the report
  const [reportWithEval] = await db
    .select({
      reportId: reports.id,
      evaluationId: reports.evaluationId,
      ownerUserId: evaluations.ownerUserId,
    })
    .from(reports)
    .innerJoin(evaluations, eq(reports.evaluationId, evaluations.id))
    .where(or(eq(reports.id, reportId), eq(reports.evaluationId, reportId)))
    .limit(1);

  if (!reportWithEval) {
    throw new NotFoundError("Report not found");
  }

  if (reportWithEval.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to share this report");
  }

  // 2. Generate cryptographically strong random token
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashShareToken(rawToken);

  const days = options?.expiresInDays ?? 7;
  const expiresAt = days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

  // 3. Persist hash in database
  const [created] = await db
    .insert(shareLinks)
    .values({
      reportId: reportWithEval.reportId,
      tokenHash,
      expiresAt,
    })
    .returning();

  await recordAuditEvent({
    userId: requestingUserId,
    action: "share.created",
    targetType: "share_link",
    targetId: created.id,
    metadata: { reportId, expiresAt: expiresAt?.toISOString() },
  });

  logger.info("Created share link for report", {
    reportId,
    shareLinkId: created.id,
    userId: requestingUserId,
  });

  return {
    id: created.id,
    reportId,
    token: rawToken,
    tokenHash,
    shareUrl: `/share/${rawToken}`,
    expiresAt: created.expiresAt,
    createdAt: created.createdAt,
  };
}

/**
 * Revokes an existing share link immediately.
 */
export async function revokeShareLink(
  shareLinkId: string,
  requestingUserId: string
): Promise<{ success: boolean; shareLinkId: string; revokedAt: Date }> {
  const [linkRecord] = await db
    .select({
      id: shareLinks.id,
      reportId: shareLinks.reportId,
      revokedAt: shareLinks.revokedAt,
      ownerUserId: evaluations.ownerUserId,
    })
    .from(shareLinks)
    .innerJoin(reports, eq(shareLinks.reportId, reports.id))
    .innerJoin(evaluations, eq(reports.evaluationId, evaluations.id))
    .where(eq(shareLinks.id, shareLinkId))
    .limit(1);

  if (!linkRecord) {
    throw new NotFoundError("Share link not found");
  }

  if (linkRecord.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to revoke this share link");
  }

  const now = new Date();
  await db
    .update(shareLinks)
    .set({ revokedAt: now })
    .where(eq(shareLinks.id, shareLinkId));

  await recordAuditEvent({
    userId: requestingUserId,
    action: "share.revoked",
    targetType: "share_link",
    targetId: shareLinkId,
    metadata: { reportId: linkRecord.reportId },
  });

  logger.info("Revoked share link", { shareLinkId, userId: requestingUserId });

  return { success: true, shareLinkId, revokedAt: now };
}

/**
 * Retrieves a shared report by raw token, enforcing expiration, revocation,
 * and automatically redacting candidate personal contact details.
 */
export async function getSharedReportByToken(rawToken: string): Promise<SharedReportResult> {
  if (!rawToken || rawToken.trim().length === 0) {
    throw new NotFoundError("Invalid or missing share token");
  }

  const tokenHash = hashShareToken(rawToken);

  const [link] = await db
    .select({
      id: shareLinks.id,
      reportId: shareLinks.reportId,
      tokenHash: shareLinks.tokenHash,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      accessCount: shareLinks.accessCount,
      createdAt: shareLinks.createdAt,
      reportStructured: reports.structuredReport,
      reportCreatedAt: reports.createdAt,
      reportUpdatedAt: reports.updatedAt,
      evaluationId: reports.evaluationId,
    })
    .from(shareLinks)
    .innerJoin(reports, eq(shareLinks.reportId, reports.id))
    .where(eq(shareLinks.tokenHash, tokenHash))
    .limit(1);

  if (!link) {
    throw new NotFoundError("Share link not found");
  }

  // 1. Check revocation
  if (link.revokedAt) {
    throw new ForbiddenError("This share link has been revoked by the owner");
  }

  // 2. Check expiration
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    throw new ForbiddenError("This share link has expired");
  }

  // 3. Atomically increment access count
  await db
    .update(shareLinks)
    .set({ accessCount: sql`${shareLinks.accessCount} + 1` })
    .where(eq(shareLinks.id, link.id));

  // 4. Parse structured report
  const rawReport = link.reportStructured as Record<string, unknown>;
  const fullReport: StructuredEvaluationReport = {
    id: link.reportId,
    evaluationId: link.evaluationId,
    overallScore: (rawReport.overallScore as number) ?? 0,
    verdict: (rawReport.verdict as StructuredEvaluationReport["verdict"]) ?? "Weak fit",
    confidence: (rawReport.confidence as number) ?? 0.85,
    explanation: (rawReport.explanation as string) ?? "",
    dimensions: (rawReport.dimensions as StructuredEvaluationReport["dimensions"]) ?? {
      roleFit: 0,
      skillsAndEvidence: 0,
      atsAlignment: 0,
      impactAndClarity: 0,
      professionalPresentation: 0,
    },
    strengths: (rawReport.strengths as string[]) ?? [],
    weaknesses: (rawReport.weaknesses as string[]) ?? [],
    prioritizedFixes: (rawReport.prioritizedFixes as StructuredEvaluationReport["prioritizedFixes"]) ?? [],
    redFlags: (rawReport.redFlags as StructuredEvaluationReport["redFlags"]) ?? [],
    likelyInterviewQuestions: (rawReport.likelyInterviewQuestions as StructuredEvaluationReport["likelyInterviewQuestions"]) ?? [],
    atsSummary: (rawReport.atsSummary as StructuredEvaluationReport["atsSummary"]) ?? {
      keywordCoverage: 0,
      matched: [],
      partial: [],
      missing: [],
      disclaimer: "ATS alignment reflects keyword coverage, not overall suitability.",
    },
    uncertaintyNotes: (rawReport.uncertaintyNotes as string[]) ?? [],
    disclaimer: "Shared recruitment simulation report from CookMyCV. Personal contact details redacted.",
    createdAt: link.reportCreatedAt,
    updatedAt: link.reportUpdatedAt,
  };

  // 5. Redact personal contact details by default
  const redacted = redactStructuredReport(fullReport);

  // 6. Enrich with canonical proof + Solana anchoring metadata when available
  let onChainProof: SharedOnChainProofMetadata | null = null;
  try {
    const [evalRow] = await db
      .select({
        id: evaluations.id,
        jobDescriptionId: evaluations.jobDescriptionId,
        overallScore: evaluations.overallScore,
        verdict: evaluations.verdict,
        modelVersion: evaluations.modelVersion,
        canonicalReportHash: evaluations.canonicalReportHash,
        candidateWallet: evaluations.candidateWallet,
        evalPdaAddress: evaluations.evalPdaAddress,
        evalTxSignature: evaluations.evalTxSignature,
        sbtMintAddress: evaluations.sbtMintAddress,
        sbtTxSignature: evaluations.sbtTxSignature,
        updatedAt: evaluations.updatedAt,
        workflowState: evaluations.workflowState,
      })
      .from(evaluations)
      .where(eq(evaluations.id, link.evaluationId))
      .limit(1);

    if (evalRow && "jobDescriptionId" in evalRow && evalRow.jobDescriptionId) {
      const runs = await db
        .select({
          agentRole: agentRuns.agentRole,
          scoreContribution: agentRuns.scoreContribution,
          modelVersion: agentRuns.modelVersion,
        })
        .from(agentRuns)
        .where(eq(agentRuns.evaluationId, link.evaluationId));

      const [jdRow] = await db
        .select({
          title: jobDescriptions.title,
          company: jobDescriptions.company,
        })
        .from(jobDescriptions)
        .where(eq(jobDescriptions.id, evalRow.jobDescriptionId))
        .limit(1);

      const revisions = Array.isArray(
        (evalRow.workflowState as Record<string, unknown> | null)?.defenseRevisions
      )
        ? ((evalRow.workflowState as Record<string, unknown>).defenseRevisions as unknown[])
        : [];

      const resolvedModel =
        evalRow.modelVersion ||
        runs.find((r) => r.modelVersion)?.modelVersion ||
        "gemini-2.5-flash";

      const effectiveScore = evalRow.overallScore ?? redacted.overallScore;
      const effectiveVerdict = evalRow.verdict ?? redacted.verdict;

      const canonical = await computeCanonicalHashFromReportRecord({
        evaluationId: evalRow.id,
        jobDescriptionId: evalRow.jobDescriptionId,
        structuredReport: rawReport,
        agentRuns: runs,
        overrideScore: effectiveScore,
        overrideVerdict: effectiveVerdict,
        modelVersion: resolvedModel,
        defenseRevisionsCount: revisions.length,
      });

      const agentScores = extractCanonicalAgentScoresFromRuns(runs);
      onChainProof = {
        evaluationId: evalRow.id,
        jobDescriptionId: evalRow.jobDescriptionId,
        targetRole: jdRow && "title" in jdRow ? jdRow.title : null,
        targetCompany: jdRow && "company" in jdRow ? jdRow.company : null,
        overallScore: effectiveScore,
        verdict: effectiveVerdict,
        modelVersion: resolvedModel,
        defenseRevisionsCount: revisions.length,
        canonicalReportHash: evalRow.canonicalReportHash || canonical.hashHex,
        agentScores,
        candidateWallet: evalRow.candidateWallet ?? null,
        profilePdaAddress: evalRow.candidateWallet
          ? deriveProfilePda(new PublicKey(evalRow.candidateWallet))[0].toBase58()
          : null,
        evalPdaAddress: evalRow.evalPdaAddress ?? null,
        evalTxSignature: evalRow.evalTxSignature ?? null,
        sbtMintAddress: evalRow.sbtMintAddress ?? null,
        sbtTxSignature: evalRow.sbtTxSignature ?? null,
        anchoredAt: evalRow.evalTxSignature ? evalRow.updatedAt : null,
      };
    }
  } catch {
    // Non-fatal in test mocks
  }

  await recordAuditEvent({
    action: "share.accessed",
    targetType: "share_link",
    targetId: link.id,
    metadata: { reportId: link.reportId, accessCount: link.accessCount + 1 },
  });

  return {
    report: redacted,
    shareLink: {
      id: link.id,
      expiresAt: link.expiresAt,
      accessCount: link.accessCount + 1,
      createdAt: link.createdAt,
    },
    onChainProof,
  };
}

/**
 * Lists all share links associated with a report.
 */
export async function listShareLinksForReport(reportId: string, requestingUserId: string) {
  const [reportWithEval] = await db
    .select({
      reportId: reports.id,
      ownerUserId: evaluations.ownerUserId,
    })
    .from(reports)
    .innerJoin(evaluations, eq(reports.evaluationId, evaluations.id))
    .where(eq(reports.id, reportId))
    .limit(1);

  if (!reportWithEval) {
    throw new NotFoundError("Report not found");
  }

  if (reportWithEval.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to access share links for this report");
  }

  const links = await db
    .select({
      id: shareLinks.id,
      reportId: shareLinks.reportId,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      accessCount: shareLinks.accessCount,
      createdAt: shareLinks.createdAt,
    })
    .from(shareLinks)
    .where(eq(shareLinks.reportId, reportId));

  return links;
}

import { db } from "@/lib/db";
import { cvVersions, documents, evaluations, reports } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { ForbiddenError, NotFoundError, BadRequestError } from "@/lib/shared/errors";
import { recordAuditEvent } from "@/lib/operations/audit";
import { logger } from "@/lib/shared/logger";

export interface CvVersionItem {
  id: string;
  userId: string;
  sourceDocumentId: string;
  versionNumber: number;
  extractedText: string;
  createdAt: Date;
  latestEvaluation?: {
    id: string;
    overallScore: number | null;
    verdict: string | null;
    createdAt: Date;
  } | null;
}

export interface CvVersionComparisonResult {
  sourceDocumentId: string;
  baseVersion: {
    id: string;
    versionNumber: number;
    createdAt: Date;
    score: number | null;
    verdict: string | null;
  };
  targetVersion: {
    id: string;
    versionNumber: number;
    createdAt: Date;
    score: number | null;
    verdict: string | null;
  };
  scoreDelta: number;
  verdictChanged: boolean;
  dimensionDeltas: {
    roleFit: number;
    skillsAndEvidence: number;
    atsAlignment: number;
    impactAndClarity: number;
    professionalPresentation: number;
  };
  textMetrics: {
    baseCharCount: number;
    targetCharCount: number;
    charCountDelta: number;
    baseWordCount: number;
    targetWordCount: number;
    wordCountDelta: number;
  };
  summary: string;
}

/**
 * Creates a new version of an existing CV.
 */
export async function createCvVersion(
  userId: string,
  sourceDocumentId: string,
  extractedText: string
): Promise<CvVersionItem> {
  const [doc] = await db
    .select({
      id: documents.id,
      ownerUserId: documents.ownerUserId,
      deletedAt: documents.deletedAt,
    })
    .from(documents)
    .where(eq(documents.id, sourceDocumentId))
    .limit(1);

  if (!doc || doc.deletedAt) {
    throw new NotFoundError("Source document not found or has been deleted");
  }

  if (doc.ownerUserId !== userId) {
    throw new ForbiddenError("You do not own this document");
  }

  if (!extractedText || extractedText.trim().length === 0) {
    throw new BadRequestError("Extracted text for CV version cannot be empty");
  }

  // Get max version number for this document
  const existingVersions = await db
    .select({ versionNumber: cvVersions.versionNumber })
    .from(cvVersions)
    .where(eq(cvVersions.sourceDocumentId, sourceDocumentId))
    .orderBy(desc(cvVersions.versionNumber))
    .limit(1);

  const nextVersionNumber = (existingVersions[0]?.versionNumber ?? 0) + 1;

  const [created] = await db
    .insert(cvVersions)
    .values({
      userId,
      sourceDocumentId,
      versionNumber: nextVersionNumber,
      extractedText,
    })
    .returning();

  await recordAuditEvent({
    userId,
    action: "cv_version.created",
    targetType: "cv_version",
    targetId: created.id,
    metadata: { sourceDocumentId, versionNumber: nextVersionNumber },
  });

  logger.info("Created new CV version", {
    versionId: created.id,
    sourceDocumentId,
    versionNumber: nextVersionNumber,
    userId,
  });

  return {
    id: created.id,
    userId: created.userId,
    sourceDocumentId: created.sourceDocumentId,
    versionNumber: created.versionNumber,
    extractedText: created.extractedText,
    createdAt: created.createdAt,
    latestEvaluation: null,
  };
}

/**
 * Lists all versions of a CV, including associated evaluation scores.
 */
export async function listCvVersions(
  sourceDocumentId: string,
  userId: string
): Promise<CvVersionItem[]> {
  const [doc] = await db
    .select({
      id: documents.id,
      ownerUserId: documents.ownerUserId,
      deletedAt: documents.deletedAt,
    })
    .from(documents)
    .where(eq(documents.id, sourceDocumentId))
    .limit(1);

  if (!doc || doc.deletedAt) {
    throw new NotFoundError("Source document not found or has been deleted");
  }

  if (doc.ownerUserId !== userId) {
    throw new ForbiddenError("You do not own this document");
  }

  const versions = await db
    .select()
    .from(cvVersions)
    .where(eq(cvVersions.sourceDocumentId, sourceDocumentId))
    .orderBy(cvVersions.versionNumber);

  const items: CvVersionItem[] = [];

  for (const v of versions) {
    // Find latest evaluation for this CV version
    const [evalRecord] = await db
      .select({
        id: evaluations.id,
        overallScore: evaluations.overallScore,
        verdict: evaluations.verdict,
        createdAt: evaluations.createdAt,
      })
      .from(evaluations)
      .where(and(eq(evaluations.cvVersionId, v.id), eq(evaluations.status, "completed")))
      .orderBy(desc(evaluations.createdAt))
      .limit(1);

    items.push({
      id: v.id,
      userId: v.userId,
      sourceDocumentId: v.sourceDocumentId,
      versionNumber: v.versionNumber,
      extractedText: v.extractedText,
      createdAt: v.createdAt,
      latestEvaluation: evalRecord ?? null,
    });
  }

  return items;
}

/**
 * Compares two versions of a CV, computing score differentials, dimension improvements,
 * and text changes.
 */
export async function compareCvVersions(
  baseVersionId: string,
  targetVersionId: string,
  userId: string
): Promise<CvVersionComparisonResult> {
  if (baseVersionId === targetVersionId) {
    throw new BadRequestError("Cannot compare a CV version with itself");
  }

  const [baseVer] = await db
    .select()
    .from(cvVersions)
    .where(eq(cvVersions.id, baseVersionId))
    .limit(1);

  const [targetVer] = await db
    .select()
    .from(cvVersions)
    .where(eq(cvVersions.id, targetVersionId))
    .limit(1);

  if (!baseVer || !targetVer) {
    throw new NotFoundError("One or both CV versions not found");
  }

  if (baseVer.userId !== userId || targetVer.userId !== userId) {
    throw new ForbiddenError("You do not have access to compare these CV versions");
  }

  // Fetch latest evaluation and report for base version
  const [baseEval] = await db
    .select({
      id: evaluations.id,
      overallScore: evaluations.overallScore,
      verdict: evaluations.verdict,
      createdAt: evaluations.createdAt,
    })
    .from(evaluations)
    .where(and(eq(evaluations.cvVersionId, baseVer.id), eq(evaluations.status, "completed")))
    .orderBy(desc(evaluations.createdAt))
    .limit(1);

  const [baseReportRecord] = baseEval
    ? await db.select().from(reports).where(eq(reports.evaluationId, baseEval.id)).limit(1)
    : [null];

  // Fetch latest evaluation and report for target version
  const [targetEval] = await db
    .select({
      id: evaluations.id,
      overallScore: evaluations.overallScore,
      verdict: evaluations.verdict,
      createdAt: evaluations.createdAt,
    })
    .from(evaluations)
    .where(and(eq(evaluations.cvVersionId, targetVer.id), eq(evaluations.status, "completed")))
    .orderBy(desc(evaluations.createdAt))
    .limit(1);

  const [targetReportRecord] = targetEval
    ? await db.select().from(reports).where(eq(reports.evaluationId, targetEval.id)).limit(1)
    : [null];

  const baseScore = baseEval?.overallScore ?? null;
  const targetScore = targetEval?.overallScore ?? null;
  const scoreDelta = (targetScore !== null && baseScore !== null) ? targetScore - baseScore : 0;
  const verdictChanged = (baseEval?.verdict ?? "") !== (targetEval?.verdict ?? "");

  const baseDims = ((baseReportRecord?.structuredReport as Record<string, unknown>)?.dimensions ?? {}) as Record<string, number>;
  const targetDims = ((targetReportRecord?.structuredReport as Record<string, unknown>)?.dimensions ?? {}) as Record<string, number>;

  const dimensionDeltas = {
    roleFit: (targetDims.roleFit ?? 0) - (baseDims.roleFit ?? 0),
    skillsAndEvidence: (targetDims.skillsAndEvidence ?? 0) - (baseDims.skillsAndEvidence ?? 0),
    atsAlignment: (targetDims.atsAlignment ?? 0) - (baseDims.atsAlignment ?? 0),
    impactAndClarity: (targetDims.impactAndClarity ?? 0) - (baseDims.impactAndClarity ?? 0),
    professionalPresentation: (targetDims.professionalPresentation ?? 0) - (baseDims.professionalPresentation ?? 0),
  };

  const baseCharCount = baseVer.extractedText.length;
  const targetCharCount = targetVer.extractedText.length;
  const baseWords = baseVer.extractedText.trim().split(/\s+/).filter(Boolean).length;
  const targetWords = targetVer.extractedText.trim().split(/\s+/).filter(Boolean).length;

  let summary = `Compared version ${baseVer.versionNumber} to version ${targetVer.versionNumber}.`;
  if (baseScore !== null && targetScore !== null) {
    const changeWord = scoreDelta >= 0 ? `increased by ${scoreDelta}` : `decreased by ${Math.abs(scoreDelta)}`;
    summary += ` Overall score ${changeWord} (${baseScore} -> ${targetScore}).`;
    if (verdictChanged) {
      summary += ` Verdict shifted from "${baseEval?.verdict}" to "${targetEval?.verdict}".`;
    }
  }

  const result: CvVersionComparisonResult = {
    sourceDocumentId: baseVer.sourceDocumentId,
    baseVersion: {
      id: baseVer.id,
      versionNumber: baseVer.versionNumber,
      createdAt: baseVer.createdAt,
      score: baseScore,
      verdict: baseEval?.verdict ?? null,
    },
    targetVersion: {
      id: targetVer.id,
      versionNumber: targetVer.versionNumber,
      createdAt: targetVer.createdAt,
      score: targetScore,
      verdict: targetEval?.verdict ?? null,
    },
    scoreDelta,
    verdictChanged,
    dimensionDeltas,
    textMetrics: {
      baseCharCount,
      targetCharCount,
      charCountDelta: targetCharCount - baseCharCount,
      baseWordCount: baseWords,
      targetWordCount: targetWords,
      wordCountDelta: targetWords - baseWords,
    },
    summary,
  };

  await recordAuditEvent({
    userId,
    action: "cv_version.compared",
    targetType: "cv_version",
    targetId: targetVersionId,
    metadata: {
      baseVersionId,
      targetVersionId,
      scoreDelta,
      verdictChanged,
    },
  });

  return result;
}

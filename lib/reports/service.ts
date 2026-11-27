import { db } from "@/lib/db";
import { reports, evaluations, jobDescriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { StructuredEvaluationReport } from "./types";
import { ForbiddenError, NotFoundError, BadRequestError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

const DISCLAIMER_NOTICE =
  "CookMyCv recruitment simulation assessment, not an official employer hiring decision.";

/**
 * Retrieves the full structured evaluation report for an evaluation,
 * strictly verifying caller ownership.
 */
export async function getEvaluationReport(
  evaluationId: string,
  requestingUserId: string
): Promise<StructuredEvaluationReport> {
  // 1. Verify evaluation existence and ownership
  const [evalRecord] = await db
    .select({
      id: evaluations.id,
      ownerUserId: evaluations.ownerUserId,
      jobDescriptionId: evaluations.jobDescriptionId,
      status: evaluations.status,
      overallScore: evaluations.overallScore,
      verdict: evaluations.verdict,
    })
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (!evalRecord) {
    throw new NotFoundError("Evaluation not found");
  }

  if (evalRecord.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to access this evaluation report");
  }

  // Fetch job description details (title & company)
  let targetRole: string | undefined;
  let targetCompany: string | undefined;
  if (evalRecord.jobDescriptionId) {
    try {
      const [jd] = await db
        .select({
          title: jobDescriptions.title,
          company: jobDescriptions.company,
        })
        .from(jobDescriptions)
        .where(eq(jobDescriptions.id, evalRecord.jobDescriptionId))
        .limit(1);
      if (jd) {
        targetRole = jd.title || undefined;
        targetCompany = jd.company || undefined;
      }
    } catch {}
  }

  // 2. Fetch persisted structured report
  const [reportRecord] = await db
    .select()
    .from(reports)
    .where(eq(reports.evaluationId, evaluationId))
    .limit(1);

  if (!reportRecord) {
    if (evalRecord.status !== "completed") {
      throw new BadRequestError(
        `Evaluation report is not ready yet. Current evaluation status: ${evalRecord.status}`
      );
    }
    throw new NotFoundError("Report for this completed evaluation was not found");
  }

  const rawStructured = (reportRecord.structuredReport ?? {}) as Record<string, unknown>;

  const structuredReport: StructuredEvaluationReport = {
    id: reportRecord.id,
    evaluationId: reportRecord.evaluationId,
    overallScore: (rawStructured.overallScore as number) ?? evalRecord.overallScore ?? 0,
    verdict: (rawStructured.verdict as StructuredEvaluationReport["verdict"]) ?? evalRecord.verdict ?? "Weak fit",
    confidence: (rawStructured.confidence as number) ?? 0.85,
    explanation: (rawStructured.explanation as string) ?? "Evaluation completed.",
    targetRole: targetRole || (rawStructured.targetRole as string) || undefined,
    targetCompany: targetCompany || (rawStructured.targetCompany as string) || undefined,
    dimensions: (rawStructured.dimensions as StructuredEvaluationReport["dimensions"]) ?? {
      roleFit: 0,
      skillsAndEvidence: 0,
      atsAlignment: 0,
      impactAndClarity: 0,
      professionalPresentation: 0,
    },
    strengths: (rawStructured.strengths as string[]) ?? [],
    weaknesses: (rawStructured.weaknesses as string[]) ?? [],
    prioritizedFixes: (rawStructured.prioritizedFixes as StructuredEvaluationReport["prioritizedFixes"]) ?? [],
    redFlags: (rawStructured.redFlags as StructuredEvaluationReport["redFlags"]) ?? [],
    likelyInterviewQuestions: (rawStructured.likelyInterviewQuestions as StructuredEvaluationReport["likelyInterviewQuestions"]) ?? [],
    atsSummary: (rawStructured.atsSummary as StructuredEvaluationReport["atsSummary"]) ?? {
      keywordCoverage: 0,
      matched: [],
      partial: [],
      missing: [],
      disclaimer: "ATS alignment reflects keyword coverage, not overall suitability.",
    },
    uncertaintyNotes: (rawStructured.uncertaintyNotes as string[]) ?? [],
    disclaimer: DISCLAIMER_NOTICE,
    pdfStorageKey: reportRecord.pdfStorageKey,
    createdAt: reportRecord.createdAt,
    updatedAt: reportRecord.updatedAt,
  };

  logger.info("Retrieved evaluation report", {
    evaluationId,
    reportId: reportRecord.id,
    userId: requestingUserId,
  });

  return structuredReport;
}

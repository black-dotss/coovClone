import { db } from "@/lib/db";
import { cvVersions, jobDescriptions } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { MultiJdComparisonInput, MultiJdComparisonResult, RoleComparisonResult } from "./types";
import { matchJobDescriptionText } from "@/lib/job-descriptions/matcher";
import { calculateWeightedScore, mapScoreToVerdict } from "@/lib/evaluations";
import { EvaluationDimensions } from "@/lib/evaluations/types";
import { ForbiddenError, NotFoundError, BadRequestError } from "@/lib/shared/errors";
import { getAIProvider, MockLLMProvider } from "@/lib/ai/providers";
import { logger } from "@/lib/shared/logger";

const AiIndividualRoleEvaluationSchema = z.object({
  roleFit: z.number().min(0).max(100),
  skillsAndEvidence: z.number().min(0).max(100),
  atsAlignment: z.number().min(0).max(100),
  impactAndClarity: z.number().min(0).max(100),
  keyStrengths: z.array(z.string()),
  criticalGaps: z.array(z.string()),
  interviewProbability: z.number().min(0).max(100),
});

type AiIndividualRoleEvaluation = z.infer<typeof AiIndividualRoleEvaluationSchema>;

/**
 * Estimates candidate professional experience in years from CV text.
 */
function estimateCandidateExperienceYears(cvText: string): number {
  const text = cvText.toLowerCase();

  // Explicit mentions: "2 years of experience", "2 yrs exp", "3+ years professional"
  const directMatch = text.match(/(\d+)\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp|background|professional|industry)/);
  if (directMatch) {
    const yrs = parseInt(directMatch[1], 10);
    if (!isNaN(yrs) && yrs > 0 && yrs <= 35) {
      return yrs;
    }
  }

  // Work history year spans: e.g. "2023 - Present", "2022 - 2024"
  const yearMatches = Array.from(text.matchAll(/\b(20[0-2]\d)\s*[-–—to]+\s*(20[0-2]\d|present|current|now)\b/g));
  if (yearMatches.length > 0) {
    const currentYear = new Date().getFullYear();
    let earliestStart = currentYear;
    let latestEnd = 2000;

    for (const match of yearMatches) {
      const start = parseInt(match[1], 10);
      const endStr = match[2].toLowerCase();
      const end =
        endStr === "present" || endStr === "current" || endStr === "now"
          ? currentYear
          : parseInt(endStr, 10);

      if (!isNaN(start) && start >= 1995 && start <= currentYear) {
        earliestStart = Math.min(earliestStart, start);
      }
      if (!isNaN(end) && end >= 1995 && end <= currentYear) {
        latestEnd = Math.max(latestEnd, end);
      }
    }

    if (earliestStart <= currentYear && latestEnd >= earliestStart) {
      const span = latestEnd - earliestStart;
      if (span >= 1 && span <= 35) {
        return span;
      }
    }
  }

  return 3;
}

/**
 * Determines required years of experience and seniority level from JD text & title.
 */
function extractRequiredExperienceYears(jdTitle: string, jdText: string): { requiredYears: number; isSeniorRole: boolean } {
  const title = (jdTitle || "").toLowerCase();
  const text = (jdText || "").toLowerCase();

  const isSeniorTitle =
    title.includes("senior") ||
    title.includes("staff") ||
    title.includes("principal") ||
    title.includes("lead") ||
    title.includes("l5") ||
    title.includes("l6") ||
    title.includes("e5") ||
    title.includes("e6") ||
    title.includes("architect");

  const reqMatch = text.match(/(\d+)\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:non-internship|software|professional|relevant|industry|work))?\s+(?:experience|development|engineering)/);
  if (reqMatch) {
    const yrs = parseInt(reqMatch[1], 10);
    if (!isNaN(yrs) && yrs > 0) {
      return { requiredYears: yrs, isSeniorRole: isSeniorTitle || yrs >= 5 };
    }
  }

  return {
    requiredYears: isSeniorTitle ? 5 : 2,
    isSeniorRole: isSeniorTitle,
  };
}

/**
 * Evaluates a single CV against 2 or 3 job descriptions using unified ATS rubrics
 * and AI-assisted deep grounded candidate comparison.
 */
export async function compareCvWithJobDescriptions(
  requestingUserId: string,
  input: MultiJdComparisonInput
): Promise<MultiJdComparisonResult> {
  const { cvVersionId, jobDescriptionIds } = input;

  // 1. Validate JD count (strictly between 2 and 3)
  if (!jobDescriptionIds || jobDescriptionIds.length < 2 || jobDescriptionIds.length > 3) {
    throw new BadRequestError(
      `Job description comparison requires between 2 and 3 job descriptions (received ${jobDescriptionIds?.length ?? 0})`
    );
  }

  // Check for duplicate JD IDs
  const uniqueJdIds = new Set(jobDescriptionIds);
  if (uniqueJdIds.size !== jobDescriptionIds.length) {
    throw new BadRequestError("Duplicate job description IDs provided in comparison request");
  }

  // 2. Fetch CV version and verify ownership
  const [cvRecord] = await db
    .select({
      id: cvVersions.id,
      userId: cvVersions.userId,
      extractedText: cvVersions.extractedText,
      sourceDocumentId: cvVersions.sourceDocumentId,
    })
    .from(cvVersions)
    .where(eq(cvVersions.id, cvVersionId))
    .limit(1);

  if (!cvRecord) {
    throw new NotFoundError("CV version not found");
  }

  if (cvRecord.userId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to evaluate this CV version");
  }

  let cvText = (cvRecord.extractedText || "").trim();

  // If CV version text is missing or sparse, fallback to source document text
  if (cvText.length < 20 && cvRecord.sourceDocumentId) {
    try {
      const { documents } = await import("@/lib/db/schema");
      const [docRecord] = await db
        .select({
          extractedText: documents.extractedText,
        })
        .from(documents)
        .where(eq(documents.id, cvRecord.sourceDocumentId))
        .limit(1);
      if (docRecord?.extractedText && docRecord.extractedText.trim().length >= 20) {
        cvText = docRecord.extractedText.trim();
      }
    } catch {
      // Ignore fallback lookup errors in mock/test
    }
  }

  if (cvText.length < 20) {
    throw new BadRequestError(
      "The selected CV does not contain readable extracted text. Please re-upload your CV with readable text."
    );
  }

  // 3. Fetch Job Descriptions and verify ownership
  const jdRecords = await db
    .select({
      id: jobDescriptions.id,
      userId: jobDescriptions.userId,
      title: jobDescriptions.title,
      company: jobDescriptions.company,
      rawText: jobDescriptions.rawText,
    })
    .from(jobDescriptions)
    .where(inArray(jobDescriptions.id, jobDescriptionIds));

  if (jdRecords.length !== jobDescriptionIds.length) {
    throw new NotFoundError("One or more job descriptions were not found");
  }

  for (const jd of jdRecords) {
    if (jd.userId !== requestingUserId) {
      throw new ForbiddenError(`You do not have permission to evaluate job description "${jd.title ?? jd.id}"`);
    }
    if (!jd.rawText || jd.rawText.trim().length < 20) {
      throw new BadRequestError(
        `Job description "${jd.title ?? jd.id}" does not contain readable requirements text.`
      );
    }
  }

  const candidateYears = estimateCandidateExperienceYears(cvText);

  // 4. Grounded Baseline Evaluation for each JD
  const evaluatedRoles: RoleComparisonResult[] = [];

  for (const jd of jdRecords) {
    const matchResult = matchJobDescriptionText(jd.rawText, cvText);
    const reqInfo = extractRequiredExperienceYears(jd.title ?? "", jd.rawText);
    const expGap = reqInfo.requiredYears - candidateYears;

    // ATS Alignment based on keyword match percentage
    const atsScore = matchResult.keywordCoveragePercentage;

    // Estimate technical fit and presentation from CV and JD match
    const matchedCount = matchResult.matchedTerms.length;
    const missingCount = matchResult.missingTerms.length;
    const totalRequirements = Math.max(1, matchedCount + matchResult.partialTerms.length + missingCount);

    let roleFit = Math.min(100, Math.round((matchedCount / totalRequirements) * 85 + 15));
    let skillsAndEvidence = Math.min(100, Math.round(atsScore * 0.9 + 10));
    const impactAndClarity = Math.min(100, Math.max(40, Math.round(cvText.length > 500 ? 75 : 55)));
    const professionalPresentation = 80;

    const criticalGaps = matchResult.missingTerms.slice(0, 3).map((m) => `Missing experience in "${m}"`);

    // Strict Seniority & Scale Calibration
    if (expGap >= 3) {
      roleFit = Math.min(32, Math.round(roleFit * 0.4));
      skillsAndEvidence = Math.min(42, Math.round(skillsAndEvidence * 0.5));
      criticalGaps.unshift(
        `Seniority gap: Candidate demonstrates ~${candidateYears} yrs experience vs ${reqInfo.requiredYears}+ yrs strictly required for ${jd.title ?? "Senior role"}`
      );
    } else if (expGap >= 1) {
      roleFit = Math.min(58, Math.round(roleFit * 0.75));
      skillsAndEvidence = Math.min(65, Math.round(skillsAndEvidence * 0.8));
      criticalGaps.unshift(
        `Experience deficit: Candidate has ~${candidateYears} yrs experience vs ${reqInfo.requiredYears}+ yrs expected`
      );
    }

    const dimensions: EvaluationDimensions = {
      roleFit,
      skillsAndEvidence,
      atsAlignment: atsScore,
      impactAndClarity,
      professionalPresentation,
    };

    const overallScore = calculateWeightedScore(dimensions);
    const verdict = mapScoreToVerdict(overallScore);

    let interviewProbability: number;
    if (expGap >= 3) {
      // Under-qualified for senior FAANG role: realistic callback probability is 12-24%
      interviewProbability = Math.min(24, Math.max(12, Math.round(overallScore * 0.35 + atsScore * 0.05)));
    } else if (expGap >= 1) {
      interviewProbability = Math.min(52, Math.max(20, Math.round(overallScore * 0.55 + atsScore * 0.15)));
    } else {
      interviewProbability = Math.min(
        96,
        Math.max(15, Math.round(overallScore * 0.65 + atsScore * 0.35 - (missingCount > 4 ? 6 : 0)))
      );
    }

    const keyStrengths = matchResult.matchedTerms.slice(0, 3).map((m) => `Demonstrated evidence for "${m}"`);

    evaluatedRoles.push({
      jobDescriptionId: jd.id,
      title: jd.title ?? "Untitled Position",
      company: jd.company ?? "Unspecified Company",
      overallScore,
      verdict,
      rank: 0,
      dimensions,
      atsKeywordCoverage: atsScore,
      keyStrengths: keyStrengths.length > 0 ? keyStrengths : ["General background alignment"],
      criticalGaps: criticalGaps.length > 0 ? criticalGaps.slice(0, 3) : ["No critical hard requirement blockers"],
      interviewProbability,
    });
  }

  // 5. If live AI Provider is configured, evaluate each role completely individually without relative curving
  try {
    const isTestEnv = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
    const provider = getAIProvider();

    if (!isTestEnv && !(provider instanceof MockLLMProvider)) {
      await Promise.all(
        evaluatedRoles.map(async (role) => {
          try {
            const jdObj = jdRecords.find((j) => j.id === role.jobDescriptionId);
            if (!jdObj) return;

            const reqInfo = extractRequiredExperienceYears(jdObj.title ?? role.title, jdObj.rawText ?? "");
            const expGap = reqInfo.requiredYears - candidateYears;

            const prompt = `You are an executive hiring committee conducting an objective INDIVIDUAL evaluation of 1 candidate CV against 1 target role.

CANDIDATE CV (Detected Experience: ~${candidateYears} years):
${cvText.slice(0, 3500)}

TARGET ROLE SPECIFICATION:
Company: ${jdObj.company}
Title: ${jdObj.title}
Requirements:
${jdObj.rawText.slice(0, 2000)}

CRITICAL EVALUATION RULES:
1. INDIVIDUAL ABSOLUTE SCORING:
   Evaluate this role strictly on its own absolute criteria and standard. Do NOT curve or grade relatively against any other role.
2. STRICT SENIORITY ENFORCEMENT:
   Candidate has ~${candidateYears} years of experience.
   If this role requires 5+ years or is titled Senior/Staff/Principal/Lead/E5/L5:
   - Candidate is under-qualified.
   - roleFit MUST be between 18 and 36 (never 70+).
   - interviewProbability MUST be between 12% and 24%.
   - criticalGaps MUST include the years of experience deficit.
3. GROUNDING: Cite verbatim proof from the candidate's CV in keyStrengths. Never hallucinate qualifications.

Respond in valid JSON adhering strictly to this schema:
{
  "roleFit": <number 0-100>,
  "skillsAndEvidence": <number 0-100>,
  "atsAlignment": <number 0-100>,
  "impactAndClarity": <number 0-100>,
  "keyStrengths": ["<specific strength referencing real CV proof>", "<second strength>", "<third strength>"],
  "criticalGaps": ["<specific missing skill or requirement from JD>", "<second gap>"],
  "interviewProbability": <number 0-100>
}`;

            const aiResponse = await provider.generateStructured<AiIndividualRoleEvaluation>({
              prompt,
              systemPrompt: "You are an objective hiring committee evaluating a candidate against a single role. Evaluate on absolute merits without grading on a curve.",
              schema: AiIndividualRoleEvaluationSchema,
              temperature: 0.15,
              timeoutMs: 30_000,
            });

            if (aiResponse?.result) {
              const res = aiResponse.result;
              if (Array.isArray(res.keyStrengths) && res.keyStrengths.length > 0) {
                role.keyStrengths = res.keyStrengths.slice(0, 3);
              }
              if (Array.isArray(res.criticalGaps) && res.criticalGaps.length > 0) {
                role.criticalGaps = res.criticalGaps.slice(0, 3);
              }
              if (typeof res.roleFit === "number") {
                let fit = Math.min(100, Math.max(10, Math.round(res.roleFit)));
                if (expGap >= 3 && fit > 38) fit = 32;
                role.dimensions.roleFit = fit;
              }
              if (typeof res.skillsAndEvidence === "number") {
                let skills = Math.min(100, Math.max(10, Math.round(res.skillsAndEvidence)));
                if (expGap >= 3 && skills > 45) skills = 40;
                role.dimensions.skillsAndEvidence = skills;
              }
              if (typeof res.atsAlignment === "number") {
                role.atsKeywordCoverage = Math.min(100, Math.max(10, Math.round(res.atsAlignment)));
                role.dimensions.atsAlignment = role.atsKeywordCoverage;
              }
              if (typeof res.impactAndClarity === "number") {
                role.dimensions.impactAndClarity = Math.min(100, Math.max(10, Math.round(res.impactAndClarity)));
              }
              if (typeof res.interviewProbability === "number") {
                let prob = Math.min(98, Math.max(10, Math.round(res.interviewProbability)));
                if (expGap >= 3 && prob > 30) {
                  prob = Math.min(24, Math.round(prob * 0.3));
                } else if (expGap >= 1 && prob > 60) {
                  prob = Math.min(50, Math.round(prob * 0.7));
                }
                role.interviewProbability = prob;
              }

              if (expGap >= 3 && !role.criticalGaps.some((g) => g.toLowerCase().includes("seniority") || g.toLowerCase().includes("experience"))) {
                role.criticalGaps.unshift(`Seniority gap: Candidate has ~${candidateYears} yrs experience vs ${reqInfo.requiredYears}+ yrs required`);
                role.criticalGaps = role.criticalGaps.slice(0, 3);
              }

              role.overallScore = calculateWeightedScore(role.dimensions);
              role.verdict = mapScoreToVerdict(role.overallScore);
            }
          } catch (singleErr) {
            logger.warn(`Individual AI evaluation for role "${role.title}" failed; using grounded baseline rubric`, {
              error: singleErr instanceof Error ? singleErr.message : String(singleErr),
            });
          }
        })
      );
    }
  } catch (aiErr) {
    logger.warn("Live individual AI evaluation skipped; using grounded baseline rubric", {
      error: aiErr instanceof Error ? aiErr.message : String(aiErr),
    });
  }

  // 6. Rank roles strictly by their individual overall scores descending
  evaluatedRoles.sort((a, b) => b.overallScore - a.overallScore);
  evaluatedRoles.forEach((role, idx) => {
    role.rank = idx + 1;
  });

  const bestRole = evaluatedRoles[0];
  const lowestRole = evaluatedRoles[evaluatedRoles.length - 1];

  const comparisonSummary =
    `Candidate is strongest fit for "${bestRole.title}" at ${bestRole.company} with an overall score of ${bestRole.overallScore} (${bestRole.verdict}), compared to ${lowestRole.overallScore} for "${lowestRole.title}".`;

  const recommendedReason =
    `Highest composite match (${bestRole.overallScore}%) with ${bestRole.atsKeywordCoverage}% keyword alignment and minimal blockers.`;

  const result: MultiJdComparisonResult = {
    cvVersionId,
    roles: evaluatedRoles,
    recommendedRole: {
      jobDescriptionId: bestRole.jobDescriptionId,
      title: bestRole.title,
      company: bestRole.company,
      reason: recommendedReason,
    },
    comparisonSummary,
    comparedAt: new Date().toISOString(),
  };

  logger.info("Completed multi-JD comparison", {
    cvVersionId,
    jdCount: jobDescriptionIds.length,
    recommendedRole: bestRole.title,
    userId: requestingUserId,
  });

  return result;
}

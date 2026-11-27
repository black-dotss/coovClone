import { db } from "@/lib/db";
import { evaluations, cvVersions, jobDescriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { DefenseSubmissionInput, DefenseRevision } from "./types";
import { mapScoreToVerdict } from "@/lib/evaluations";
import { Verdict } from "@/lib/evaluations/types";
import { ForbiddenError, NotFoundError, BadRequestError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import { getAIProvider } from "@/lib/ai/providers";

/**
 * Evaluates user defense submission and calculates a bounded reassessment delta.
 * Ensures reassessments are strictly bounded (+2 to +8 points per defense,
 * with a maximum cumulative cap of +15 points), preventing trivial score inflation.
 */
export function calculateBoundedReassessment(
  defense: DefenseSubmissionInput,
  currentScore: number,
  cumulativeDeltaSoFar: number
): { scoreDelta: number; rationale: string } {
  const trimmed = defense.defenseText.trim();

  if (trimmed.length < 10) {
    throw new BadRequestError("Defense context must be substantive (at least 10 characters)");
  }

  // Maximum cumulative reassessment ceiling is +15 points
  const remainingAllowance = Math.max(0, 15 - cumulativeDeltaSoFar);
  if (remainingAllowance <= 0) {
    return {
      scoreDelta: 0,
      rationale:
        "Defense context reviewed, but maximum cumulative reassessment cap (+15 points) has already been reached for this evaluation.",
    };
  }

  // Calculate bounded score delta: Only award points for genuine, substantive reasons or evidence!
  const hasEvidence = Boolean(defense.supportingEvidence && defense.supportingEvidence.trim().length >= 10);
  const isSubstantive = trimmed.length >= 60;
  const hasTechKeywords = /\b(repo|github|pr|commit|production|cluster|architecture|deployed|metrics|latency|scale|docker|kubernetes|aws|database|cache|redis|postgres|sql|test|tests|testing|tested|pipeline|ci\/cd|api|service|microservices|infrastructure|monitoring|refactored|terraform|gcp|azure|methodologies|coverage)\b/i.test(trimmed);
  const isExcusesOnly = /^(i know|i can learn|not my fault|unfair|i just didn't|simple mistake|i forgot|trust me|give me a chance)/i.test(trimmed) && !hasEvidence;

  let delta = 0;
  if (isExcusesOnly) {
    delta = 0;
  } else if (hasEvidence && isSubstantive) {
    delta = Math.min(6, Math.max(3, 3 + (trimmed.length >= 80 ? 2 : 0) + 3)); // Substantive explanation backed by concrete evidence link
  } else if (hasEvidence) {
    delta = 3; // Evidence cited
  } else if (isSubstantive && hasTechKeywords) {
    delta = 3; // Substantive technical context resolving the question
  } else {
    delta = 0; // Generic, brief, or unsubstantiated defense receives NO score addition
  }

  const finalDelta = Math.min(delta, remainingAllowance);

  const rationale =
    finalDelta > 0
      ? `Candidate provided credible clarification regarding "${defense.claimOrFlag}". Reduced criticism severity and adjusted composite score by +${finalDelta} points.`
      : `Clarification for "${defense.claimOrFlag}" was noted, but was deemed insufficient to adjust composite score (0 pts awarded).`;

  return {
    scoreDelta: finalDelta,
    rationale,
  };
}

/**
 * Submits a candidate defense against an evaluation criticism or gap,
 * runs a bounded reassessment, persists the revision, and preserves the original report.
 */
export async function submitDefense(
  evaluationId: string,
  requestingUserId: string,
  input: DefenseSubmissionInput
): Promise<DefenseRevision> {
  // 1. Verify evaluation existence and ownership
  const [evalRecord] = await db
    .select({
      id: evaluations.id,
      ownerUserId: evaluations.ownerUserId,
      cvVersionId: evaluations.cvVersionId,
      jobDescriptionId: evaluations.jobDescriptionId,
      status: evaluations.status,
      overallScore: evaluations.overallScore,
      verdict: evaluations.verdict,
      workflowState: evaluations.workflowState,
    })
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (!evalRecord) {
    throw new NotFoundError("Evaluation not found");
  }

  if (evalRecord.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to submit a defense for this evaluation");
  }

  if (evalRecord.status !== "completed") {
    throw new BadRequestError(
      `Cannot defend an evaluation that is not completed (current status: ${evalRecord.status})`
    );
  }

  // 2. Fetch baseline score & context (CV and JD)
  const currentScore = evalRecord.overallScore ?? 50;
  const currentVerdict = (evalRecord.verdict as Verdict | null) ?? mapScoreToVerdict(currentScore);

  let cvText = "";
  if (evalRecord.cvVersionId) {
    const [cvRec] = await db
      .select({ extractedText: cvVersions.extractedText })
      .from(cvVersions)
      .where(eq(cvVersions.id, evalRecord.cvVersionId))
      .limit(1);
    cvText = cvRec?.extractedText ?? "";
  }

  let roleTitle = "Target Role";
  let company = "Target Company";
  let jdText = "";
  if (evalRecord.jobDescriptionId) {
    const [jdRec] = await db
      .select({
        title: jobDescriptions.title,
        company: jobDescriptions.company,
        rawText: jobDescriptions.rawText,
      })
      .from(jobDescriptions)
      .where(eq(jobDescriptions.id, evalRecord.jobDescriptionId))
      .limit(1);
    if (jdRec) {
      roleTitle = jdRec.title || roleTitle;
      company = jdRec.company || company;
      jdText = jdRec.rawText || "";
    }
  }

  // 3. Inspect existing revisions in workflowState
  const currentState = (evalRecord.workflowState ?? {}) as Record<string, unknown>;
  const existingRevisions = ((currentState.defenseRevisions as DefenseRevision[]) ?? []).slice();

  const cumulativeDelta = existingRevisions.reduce((sum, rev) => sum + rev.scoreDelta, 0);
  const remainingAllowance = Math.max(0, 15 - cumulativeDelta);

  // 4. Calculate AI committee reassessment & persona dialogue
  let scoreDelta = 0;
  let rationale = "";
  let revisedFindings: string[] = [`Addressed: ${input.claimOrFlag} — Context acknowledged by panel`];
  let committeeDialogue: Array<{ persona: string; role: string; comment: string }> = [];

  if (remainingAllowance > 0) {
    try {
      const provider = getAIProvider();
      const prompt = `You are the executive hiring committee (HR Recruiter, Technical Interviewer, Hiring Manager, Bar Raiser) conducting a formal appeal reassessment for a candidate who is contesting a critical evaluation deduction.

Candidate CV extract:
"""
${cvText ? cvText.slice(0, 2500) : "Not available"}
"""

Role & Company:
Role: ${roleTitle}
Company: ${company}
Job Requirements:
"""
${jdText ? jdText.slice(0, 1500) : "Standard technical expectations for " + roleTitle}
"""

Contested Claim/Flag: "${input.claimOrFlag}"
Candidate Defense Explanation: "${input.defenseText}"
Candidate Supporting Evidence: "${input.supportingEvidence || "None provided"}"
Previous Overall Score: ${currentScore}/100
Remaining Reassessment Allowance: ${remainingAllowance} points

Critically evaluate this defense:
CRITICAL SCORING RULES:
1. Not every defense should be awarded points! Only good, credible, well-justified defenses earn points.
2. If the candidate gives a weak reason, makes excuses, lacks technical details, or provides no compelling evidence: YOU MUST SET scoreDelta to 0 (score remains unchanged, 0 pts awarded).
3. ONLY if the candidate provides compelling, substantive clarification or proof that genuinely resolves the critique, award a justified score adjustment delta (+2 to +5 points, capped at ${Math.min(5, remainingAllowance)} points).
4. Provide a clear, objective 1-2 sentence ruling rationale.

Respond strictly in valid JSON format:
{
  "scoreDelta": 0,
  "rationale": "...",
  "revisedFindings": ["..."],
  "committeeDialogue": [
    {
      "persona": "Technical Interviewer",
      "role": "technical_interviewer",
      "comment": "..."
    },
    {
      "persona": "Hiring Manager",
      "role": "hiring_manager",
      "comment": "..."
    }
  ]
}`;

      const rawResp = await provider.generateText({
        prompt,
        systemPrompt: "You are an AI hiring committee conducting a formal appeal reassessment. Be strictly discerning and award points only for genuine, well-substantiated reasons. Respond only in valid JSON.",
        temperature: 0.2,
      });
      const raw = rawResp.result;

      const parsed = JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
      if (typeof parsed.scoreDelta === "number") {
        scoreDelta = Math.min(Math.max(0, Math.round(parsed.scoreDelta)), remainingAllowance);
      } else {
        const fallback = calculateBoundedReassessment(input, currentScore, cumulativeDelta);
        scoreDelta = fallback.scoreDelta;
      }
      rationale =
        parsed.rationale ||
        (scoreDelta > 0
          ? `Committee reviewed defense regarding "${input.claimOrFlag}" and adjusted score by +${scoreDelta} pts.`
          : `Candidate clarification for "${input.claimOrFlag}" was reviewed, but was insufficient to adjust score (0 pts awarded).`);
      if (Array.isArray(parsed.revisedFindings) && parsed.revisedFindings.length > 0) {
        revisedFindings = parsed.revisedFindings;
      }
      if (Array.isArray(parsed.committeeDialogue) && parsed.committeeDialogue.length > 0) {
        committeeDialogue = parsed.committeeDialogue;
      }
    } catch (err) {
      logger.warn("AI defense reassessment failed, using bounded fallback", { error: err });
      const fallback = calculateBoundedReassessment(input, currentScore, cumulativeDelta);
      scoreDelta = fallback.scoreDelta;
      rationale = fallback.rationale;
    }
  } else {
    rationale = "Defense context reviewed, but maximum cumulative reassessment cap (+15 points) has already been reached for this evaluation.";
  }

  if (committeeDialogue.length === 0) {
    committeeDialogue =
      scoreDelta > 0
        ? [
            {
              persona: "Technical Interviewer",
              role: "technical_interviewer",
              comment: `Reviewed candidate clarification regarding "${input.claimOrFlag}". The additional engineering context sufficiently clarifies operational ownership.`,
            },
            {
              persona: "Hiring Manager",
              role: "hiring_manager",
              comment: `Agreed. Taking the submitted evidence into account, I approve adjusting the composite score by +${scoreDelta} pts.`,
            },
          ]
        : [
            {
              persona: "Technical Interviewer",
              role: "technical_interviewer",
              comment: `Reviewed candidate clarification for "${input.claimOrFlag}". The explanation lacks concrete architectural specifics, so the deduction remains upheld.`,
            },
            {
              persona: "Hiring Manager",
              role: "hiring_manager",
              comment: `Agreed. Without verifiable evidence or measurable project context, no score adjustment is justified.`,
            },
          ];
  }

  const newScore = Math.min(100, Math.round((currentScore + scoreDelta) * 100) / 100);
  const newVerdict = mapScoreToVerdict(newScore);

  const newRevision: DefenseRevision = {
    revisionNumber: existingRevisions.length + 1,
    submittedAt: new Date().toISOString(),
    claimOrFlag: input.claimOrFlag,
    defenseText: input.defenseText,
    supportingEvidence: input.supportingEvidence,
    scoreDelta,
    previousScore: currentScore,
    newScore,
    previousVerdict: currentVerdict,
    newVerdict,
    reassessmentRationale: rationale,
    revisedFindings,
    committeeDialogue,
  };

  existingRevisions.push(newRevision);

  // 5. Update evaluation with new revision and updated scores
  // Note: Original report in 'reports' table is strictly PRESERVED without overwriting!
  await db
    .update(evaluations)
    .set({
      overallScore: Math.round(newScore),
      verdict: newVerdict,
      workflowState: {
        ...currentState,
        defenseRevisions: existingRevisions,
        lastDefendedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(evaluations.id, evaluationId));

  logger.info("Processed defense submission and bounded reassessment", {
    evaluationId,
    revisionNumber: newRevision.revisionNumber,
    scoreDelta,
    newScore,
    userId: requestingUserId,
  });

  return newRevision;
}

/**
 * Lists all defense revisions for an evaluation, verifying caller ownership.
 */
export async function listDefenses(
  evaluationId: string,
  requestingUserId: string
): Promise<DefenseRevision[]> {
  const [evalRecord] = await db
    .select({
      ownerUserId: evaluations.ownerUserId,
      workflowState: evaluations.workflowState,
    })
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (!evalRecord) {
    throw new NotFoundError("Evaluation not found");
  }

  if (evalRecord.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to view defenses for this evaluation");
  }

  const currentState = (evalRecord.workflowState ?? {}) as Record<string, unknown>;
  return (currentState.defenseRevisions as DefenseRevision[]) ?? [];
}

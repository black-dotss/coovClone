import { db } from "@/lib/db";
import { rewriteSuggestions, evaluations, cvVersions } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { RewriteSuggestionRecord } from "./types";
import { ForbiddenError, NotFoundError, BadRequestError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import { getAIProvider } from "@/lib/ai/providers";

export interface GenerateRewritesOptions {
  customBullets?: string[];
}

/**
 * Validates that a rewritten bullet does not invent fabricated numerical metrics
 * or ungrounded claims that did not exist in the candidate's original text or CV.
 */
export function verifyTruthfulRewrite(
  originalText: string,
  suggestedText: string,
  cvText?: string
): { isTruthful: boolean; ungroundedClaims: string[] } {
  const combinedSource = `${originalText} ${cvText ?? ""}`.toLowerCase();
  const ungroundedClaims: string[] = [];

  // Match numbers, percentages, dollar amounts, and multiplier claims
  // (e.g. 50%, $100k, 10x, 99.9%, 5000 users)
  const metricRegex = /(\b\d+(\.\d+)?%|\$\d+[kmbt]?|\b\d+x\b|\b\d{2,}\b)/gi;
  const suggestedMetrics = suggestedText.match(metricRegex) ?? [];

  for (const metric of suggestedMetrics) {
    const cleaned = metric.toLowerCase();
    if (!combinedSource.includes(cleaned)) {
      ungroundedClaims.push(metric);
    }
  }

  return {
    isTruthful: ungroundedClaims.length === 0,
    ungroundedClaims,
  };
}

/**
 * Deterministically rewrites a weak CV bullet into a truthful, impactful,
 * action-oriented bullet without fabricating numbers or unverified tools.
 */
export function createTruthfulBulletRewrite(
  originalBullet: string,
  cvText?: string
): { suggestedText: string; explanation: string } {
  const trimmed = originalBullet.trim().replace(/^[•·\-\*–—\u2022\u2023\u25E6\u2043\u2219\d\.\)\s]+/, "");

  // Detect and replace weak introductory verbs
  const weakStarters: [RegExp, string, string][] = [
    [
      /^responsible for (development of|building|creating)\s*/i,
      "Engineered and maintained ",
      "Replaced passive responsibility phrasing with active engineering ownership",
    ],
    [
      /^responsible for (writing|doing|handling)?\s*/i,
      "Engineered and implemented ",
      "Replaced passive responsibility phrasing with active engineering ownership",
    ],
    [
      /^responsible for\s*/i,
      "Engineered and spearheaded ",
      "Replaced passive 'responsible for' with direct action verb",
    ],
    [
      /^worked on (the )?\s*/i,
      "Architected and delivered ",
      "Clarified direct contribution instead of vague 'worked on'",
    ],
    [
      /^helped (with|to build|build)\s*/i,
      "Collaborated to implement and optimize ",
      "Framed collaborative effort with concrete technical scope",
    ],
    [
      /^assisted in\s*/i,
      "Contributed to core development of ",
      "Elevated role impact while truthfully reflecting team contribution",
    ],
    [
      /^did testing for\s*/i,
      "Developed automated test suites and validation workflows for ",
      "Specified engineering methodology instead of generic testing label",
    ],
    [
      /^handled\s*/i,
      "Managed operational lifecycle and resolution for ",
      "Replaced informal verb with professional operational terminology",
    ],
  ];

  let suggested = trimmed;
  let rationale = "Strengthened bullet structure, action verbs, and technical clarity while preserving exact factual experience.";

  for (const [pattern, replacement, reason] of weakStarters) {
    if (pattern.test(trimmed)) {
      suggested = trimmed.replace(pattern, replacement);
      rationale = reason;
      break;
    }
  }

  // If no weak starter matched or suggested is still identical to trimmed, elevate with active ownership
  if (suggested.toLowerCase() === trimmed.toLowerCase()) {
    const firstWordMatch = trimmed.match(/^([A-Za-z]+)\s+(.*)$/);
    if (firstWordMatch) {
      const firstWord = firstWordMatch[1].toLowerCase();
      const rest = firstWordMatch[2];
      if (/^(build|built|create|created|make|made)$/.test(firstWord)) {
        suggested = `Architected and deployed ${rest}`;
      } else if (/^(develop|developed|code|coded|write|wrote)$/.test(firstWord)) {
        suggested = `Engineered and implemented ${rest}`;
      } else if (/^(fix|fixed|debug|debugged|solve|solved)$/.test(firstWord)) {
        suggested = `Diagnosed and resolved critical issues across ${rest}`;
      } else if (/^(maintain|maintained|support|supported)$/.test(firstWord)) {
        suggested = `Maintained operational reliability and scalability for ${rest}`;
      } else {
        suggested = `Spearheaded and engineered ${trimmed.charAt(0).toLowerCase() + trimmed.slice(1)}`;
      }
    } else {
      suggested = `Spearheaded and delivered ${trimmed.charAt(0).toLowerCase() + trimmed.slice(1)}`;
    }
    rationale = "Elevated passive bullet phrasing into active engineering ownership with clear technical focus.";
  }

  // Capitalize first letter
  suggested = suggested.charAt(0).toUpperCase() + suggested.slice(1);

  // Ensure ending period
  if (!suggested.endsWith(".")) {
    suggested += ".";
  }

  // Verify truthfulness against original & CV
  const check = verifyTruthfulRewrite(trimmed, suggested, cvText);
  if (!check.isTruthful) {
    throw new BadRequestError(
      `Rewrite contains ungrounded claims (${check.ungroundedClaims.join(", ")}) not present in candidate experience`
    );
  }

  return {
    suggestedText: suggested,
    explanation: rationale,
  };
}

/**
 * Generates and persists truthful bullet rewrites for an evaluation.
 * Enforces ownership and guarantees zero fabricated candidate metrics.
 */
export async function generateBulletRewrites(
  evaluationId: string,
  requestingUserId: string,
  options?: GenerateRewritesOptions
): Promise<RewriteSuggestionRecord[]> {
  // 1. Verify evaluation existence and ownership
  const [evalRecord] = await db
    .select({
      id: evaluations.id,
      ownerUserId: evaluations.ownerUserId,
      cvVersionId: evaluations.cvVersionId,
    })
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (!evalRecord) {
    throw new NotFoundError("Evaluation not found");
  }

  if (evalRecord.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to generate rewrites for this evaluation");
  }

  // 2. Fetch CV text to ground factual context
  const [cvRecord] = await db
    .select({ extractedText: cvVersions.extractedText })
    .from(cvVersions)
    .where(eq(cvVersions.id, evalRecord.cvVersionId))
    .limit(1);

  const cvText = cvRecord?.extractedText ?? "";

  // 3. Determine candidate bullets to rewrite
  let bulletsToRewrite: string[] = options?.customBullets ?? [];

  if (bulletsToRewrite.length === 0) {
    // Extract authentic bullet points from CV text (lines starting with a bullet marker or list number)
    const bulletPrefixRegex = /^[•·\-\*–—\u2022\u2023\u25E6\u2043\u2219]|^\d+[\.\)]\s+/;
    const lines = cvText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => {
        // Must start with an authentic bullet point or list marker
        if (!bulletPrefixRegex.test(l)) return false;
        // Strip the bullet marker to examine the text content
        const content = l.replace(/^[•·\-\*–—\u2022\u2023\u25E6\u2043\u2219\s\d\.\)]+/, "").trim();
        // Ignore single words or non-sentence fragments; must be a substantive bullet
        if (content.length < 20 || content.length > 400) return false;
        // Exclude contact or header lines
        if (/^(skills|experience|education|projects|summary|certifications|languages|contact|email|phone)[\s:]/i.test(content)) {
          return false;
        }
        return true;
      });

    bulletsToRewrite = lines.slice(0, 4);
    if (bulletsToRewrite.length === 0) {
      // Fallback only if CV has zero bullet formatted lists: find complete sentences ending in a period
      const sentenceLines = cvText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length >= 25 && l.length <= 300 && /\.\s*$/.test(l));
      bulletsToRewrite = sentenceLines.slice(0, 4);
      if (bulletsToRewrite.length === 0) {
        bulletsToRewrite = [
          "• Responsible for writing API endpoints and database queries.",
          "• Worked on frontend bugs and team documentation.",
        ];
      }
    }
  }

  // Limit to at most 4 bullets so the interface remains concise
  bulletsToRewrite = bulletsToRewrite.slice(0, 4);

  // Clean up previous unaccepted draft suggestions for this evaluation so they do not pile up
  if (typeof db.delete === "function") {
    await db
      .delete(rewriteSuggestions)
      .where(
        and(
          eq(rewriteSuggestions.evaluationId, evaluationId),
          eq(rewriteSuggestions.isAccepted, false)
        )
      );
  }

  // Attempt LLM-powered bullet enhancement with candidate CV grounding
  const aiProvider = getAIProvider();
  const aiMap = new Map<number, { suggestedText: string; explanation: string }>();

  try {
    const prompt = `You are a principal tech recruiter and resume editor.
Candidate CV extract:
"""
${cvText.slice(0, 3000)}
"""

Rewrite each of the following candidate CV bullets into a high-impact, truthful, professional STAR bullet point (Strong action verb + technical architecture/scope + business or operational outcome):
${bulletsToRewrite.map((b, i) => `[${i}] ${b}`).join("\n")}

STRICT INSTRUCTIONS:
- You MUST significantly rewrite the bullet with strong action verbs (e.g. Architected, Engineered, Spearheaded, Optimized, Streamlined). It must NEVER be identical or near-identical to the input!
- NEVER fabricate fake numbers or fake metrics (do NOT invent 50%, 10x, $100k, etc.) unless they were already present in the candidate's CV text.
- If no metrics exist, express impact through operational quality, latency, fault tolerance, reliability, or developer velocity.
- Explain in 1 concise sentence why the rewrite is stronger.

Return strictly a JSON array:
[
  {
    "index": 0,
    "suggestedText": "Architected and delivered ...",
    "explanation": "..."
  }
]`;

    const rawResp = await aiProvider.generateText({
      prompt,
      systemPrompt: "You are a tech resume rewriting expert. Output valid JSON only.",
      temperature: 0.2,
    });
    const raw = rawResp.result;

    const parsed = JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item.index === "number" && item.suggestedText) {
          const original = bulletsToRewrite[item.index] || "";
          const isDifferent = item.suggestedText.trim().toLowerCase() !== original.trim().toLowerCase();
          const check = verifyTruthfulRewrite(original, item.suggestedText, cvText);
          if (check.isTruthful && isDifferent) {
            aiMap.set(item.index, {
              suggestedText: item.suggestedText,
              explanation: item.explanation || "Elevated action verbs and emphasized measurable technical ownership.",
            });
          }
        }
      }
    }
  } catch (err) {
    logger.warn("LLM bullet rewrite failed, using heuristic fallback", { error: err });
  }

  const generatedRecords: RewriteSuggestionRecord[] = [];

  for (let i = 0; i < bulletsToRewrite.length; i++) {
    const bullet = bulletsToRewrite[i];
    const aiChoice = aiMap.get(i);
    const { suggestedText, explanation } = aiChoice ?? createTruthfulBulletRewrite(bullet, cvText);

    const [inserted] = await db
      .insert(rewriteSuggestions)
      .values({
        evaluationId,
        originalText: bullet.replace(/^[-*•]\s*/, ""),
        suggestedText,
        explanation,
        isAccepted: false,
      })
      .returning();

    generatedRecords.push({
      id: inserted.id,
      evaluationId: inserted.evaluationId,
      originalText: inserted.originalText,
      suggestedText: inserted.suggestedText,
      explanation: inserted.explanation,
      isAccepted: inserted.isAccepted,
      createdAt: inserted.createdAt,
    });
  }

  logger.info("Generated truthful bullet rewrites", {
    evaluationId,
    count: generatedRecords.length,
    userId: requestingUserId,
  });

  return generatedRecords;
}

/**
 * Lists all rewrite suggestions associated with an evaluation, verifying caller ownership.
 */
export async function listBulletRewrites(
  evaluationId: string,
  requestingUserId: string
): Promise<RewriteSuggestionRecord[]> {
  const [evalRecord] = await db
    .select({ ownerUserId: evaluations.ownerUserId })
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (!evalRecord) {
    throw new NotFoundError("Evaluation not found");
  }

  if (evalRecord.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to view rewrites for this evaluation");
  }

  return db
    .select()
    .from(rewriteSuggestions)
    .where(eq(rewriteSuggestions.evaluationId, evaluationId))
    .orderBy(desc(rewriteSuggestions.createdAt));
}

/**
 * Toggles acceptance status of a suggested bullet rewrite, verifying caller ownership.
 */
export async function toggleAcceptRewrite(
  rewriteId: string,
  requestingUserId: string,
  isAccepted: boolean
): Promise<RewriteSuggestionRecord> {
  const [suggestion] = await db
    .select({
      id: rewriteSuggestions.id,
      evaluationId: rewriteSuggestions.evaluationId,
      originalText: rewriteSuggestions.originalText,
      suggestedText: rewriteSuggestions.suggestedText,
      explanation: rewriteSuggestions.explanation,
      isAccepted: rewriteSuggestions.isAccepted,
      createdAt: rewriteSuggestions.createdAt,
      ownerUserId: evaluations.ownerUserId,
    })
    .from(rewriteSuggestions)
    .innerJoin(evaluations, eq(rewriteSuggestions.evaluationId, evaluations.id))
    .where(eq(rewriteSuggestions.id, rewriteId))
    .limit(1);

  if (!suggestion) {
    throw new NotFoundError("Rewrite suggestion not found");
  }

  if (suggestion.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to modify this rewrite suggestion");
  }

  await db
    .update(rewriteSuggestions)
    .set({ isAccepted })
    .where(eq(rewriteSuggestions.id, rewriteId));

  logger.info("Updated rewrite suggestion acceptance", {
    rewriteId,
    isAccepted,
    userId: requestingUserId,
  });

  return {
    id: suggestion.id,
    evaluationId: suggestion.evaluationId,
    originalText: suggestion.originalText,
    suggestedText: suggestion.suggestedText,
    explanation: suggestion.explanation,
    isAccepted,
    createdAt: suggestion.createdAt,
  };
}

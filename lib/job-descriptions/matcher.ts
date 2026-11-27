import type {
  NormalizedRequirements,
  MatchedRequirementResult,
  AtsMatchReport,
} from "./types";
import { extractAndNormalizeRequirements } from "./extractor";

/**
 * Escapes regex special characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extracts a readable evidence snippet surrounding the matched keyword.
 */
function extractEvidenceSnippet(fullText: string, matchIndex: number, matchLength: number): string {
  const windowRadius = 60;
  const start = Math.max(0, matchIndex - windowRadius);
  const end = Math.min(fullText.length, matchIndex + matchLength + windowRadius);

  let snippet = fullText.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < fullText.length) snippet = `${snippet}...`;

  return snippet;
}

/**
 * Compares normalized requirements with CV text and generates a comprehensive ATS report.
 * Explicitly separates keyword coverage from overall suitability.
 */
export function matchRequirementsAgainstCv(
  requirements: NormalizedRequirements,
  cvText: string,
  jobDescriptionId?: string
): AtsMatchReport {
  const results: MatchedRequirementResult[] = [];
  const matchedTerms: string[] = [];
  const partialTerms: string[] = [];
  const missingTerms: string[] = [];

  for (const req of requirements.requirements) {
    // 1. Try Exact Match (word boundaries)
    const exactRegex = new RegExp(`\\b${escapeRegex(req.term)}\\b`, "i");
    const exactMatch = exactRegex.exec(cvText);

    if (exactMatch) {
      const snippet = extractEvidenceSnippet(cvText, exactMatch.index, exactMatch[0].length);
      results.push({
        requirementId: req.id,
        category: req.category,
        importance: req.importance,
        term: req.term,
        classification: "matched",
        isAliasMatch: false,
        matchedTerm: exactMatch[0],
        evidenceSnippet: snippet,
        confidence: 1.0,
      });
      matchedTerms.push(req.term);
      continue;
    }

    // 2. Try Alias / Synonyms Match
    let aliasMatched = false;
    for (const alias of req.aliases) {
      const aliasRegex = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
      const aliasMatch = aliasRegex.exec(cvText);

      if (aliasMatch) {
        const snippet = extractEvidenceSnippet(cvText, aliasMatch.index, aliasMatch[0].length);
        results.push({
          requirementId: req.id,
          category: req.category,
          importance: req.importance,
          term: req.term,
          classification: "partial",
          isAliasMatch: true,
          matchedTerm: aliasMatch[0],
          evidenceSnippet: snippet,
          confidence: 0.8,
        });
        partialTerms.push(`${req.term} (via alias: ${aliasMatch[0]})`);
        aliasMatched = true;
        break;
      }
    }

    if (aliasMatched) {
      continue;
    }

    // 3. Mark Missing
    results.push({
      requirementId: req.id,
      category: req.category,
      importance: req.importance,
      term: req.term,
      classification: "missing",
      isAliasMatch: false,
      confidence: 0.0,
    });
    missingTerms.push(req.term);
  }

  const total = results.length;
  const matchedCount = matchedTerms.length;
  const partialCount = partialTerms.length;
  const missingCount = missingTerms.length;

  const coverage =
    total > 0
      ? Math.round(((matchedCount * 1.0 + partialCount * 0.5) / total) * 100)
      : 0;

  return {
    jobDescriptionId,
    totalRequirements: total,
    matchedCount,
    partialCount,
    missingCount,
    keywordCoveragePercentage: coverage,
    results,
    matchedTerms,
    partialTerms,
    missingTerms,
    disclaimer:
      "Keyword coverage measures lexical and semantic vocabulary overlap for ATS parsing. It is strictly separate from overall role suitability and recruitment panel verdicts.",
  };
}

export function matchJobDescriptionText(
  jdText: string,
  cvText: string,
  jobDescriptionId?: string
): AtsMatchReport {
  const reqs = extractAndNormalizeRequirements(jdText);
  return matchRequirementsAgainstCv(reqs, cvText, jobDescriptionId);
}


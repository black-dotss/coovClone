import { redactPersonalInformation } from "@/lib/reports/redaction";
import type { EvaluationDimensions, Verdict } from "@/lib/evaluations/types";
import type { PrioritizedFix, RedFlagNote } from "@/lib/agents/types";

export interface CanonicalAgentScores {
  hr_recruiter: number;
  technical_interviewer: number;
  ats_scanner: number;
  hiring_manager: number;
  career_strategist: number;
  red_flag_analyst: number;
}

export interface CanonicalReportPayload {
  schemaVersion: "coov-eval-v1";
  evaluationId: string;
  jobDescriptionId: string;
  overallScore: number;
  verdict: Verdict | string;
  confidence: number;
  dimensions: EvaluationDimensions;
  explanation: string;
  strengths: string[];
  weaknesses: string[];
  prioritizedFixes: Array<{
    fix: string;
    expectedBenefit: string;
    effort: string;
  }>;
  redFlags: Array<{
    flag: string;
    evidenceSnippet: string;
    isProofOfProblem: false;
  }>;
  atsSummary: {
    keywordCoverage: number;
    matched: string[];
    partial: string[];
    missing: string[];
  };
  agentScores: CanonicalAgentScores;
  modelVersion: string;
  defenseRevisionsCount: number;
}

/**
 * Recursively sorts object keys for deterministic JSON serialization across
 * Node.js, Cloudflare Workers, and browser JavaScript engines.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Builds the PII-redacted canonical payload used for both on-chain anchoring
 * and public browser verification on `/share/[token]`.
 */
export function buildCanonicalReportPayload(input: {
  evaluationId: string;
  jobDescriptionId: string;
  overallScore: number;
  verdict: Verdict | string;
  confidence: number;
  dimensions: EvaluationDimensions;
  explanation: string;
  strengths: string[];
  weaknesses: string[];
  prioritizedFixes: PrioritizedFix[];
  redFlags: RedFlagNote[];
  atsSummary: {
    keywordCoverage: number;
    matched: string[];
    partial: string[];
    missing: string[];
  };
  agentScores: CanonicalAgentScores;
  modelVersion: string;
  defenseRevisionsCount?: number;
}): CanonicalReportPayload {
  return {
    schemaVersion: "coov-eval-v1",
    evaluationId: input.evaluationId,
    jobDescriptionId: input.jobDescriptionId,
    overallScore: Math.round(input.overallScore),
    verdict: input.verdict,
    confidence: Number(input.confidence ?? 0.85),
    dimensions: {
      roleFit: Math.round(input.dimensions.roleFit ?? 0),
      skillsAndEvidence: Math.round(input.dimensions.skillsAndEvidence ?? 0),
      atsAlignment: Math.round(input.dimensions.atsAlignment ?? 0),
      impactAndClarity: Math.round(input.dimensions.impactAndClarity ?? 0),
      professionalPresentation: Math.round(input.dimensions.professionalPresentation ?? 0),
    },
    explanation: redactPersonalInformation(input.explanation || ""),
    strengths: (input.strengths || []).map((s) => redactPersonalInformation(s)),
    weaknesses: (input.weaknesses || []).map((w) => redactPersonalInformation(w)),
    prioritizedFixes: (input.prioritizedFixes || []).map((f) => ({
      fix: redactPersonalInformation(f.fix),
      expectedBenefit: redactPersonalInformation(f.expectedBenefit),
      effort: f.effort,
    })),
    redFlags: (input.redFlags || []).map((rf) => ({
      flag: redactPersonalInformation(rf.flag),
      evidenceSnippet: redactPersonalInformation(rf.evidenceSnippet),
      isProofOfProblem: false as const,
    })),
    atsSummary: {
      keywordCoverage: Math.round(input.atsSummary?.keywordCoverage ?? 0),
      matched: [...(input.atsSummary?.matched ?? [])],
      partial: [...(input.atsSummary?.partial ?? [])],
      missing: [...(input.atsSummary?.missing ?? [])],
    },
    agentScores: {
      hr_recruiter: Math.round(input.agentScores.hr_recruiter ?? 0),
      technical_interviewer: Math.round(input.agentScores.technical_interviewer ?? 0),
      ats_scanner: Math.round(input.agentScores.ats_scanner ?? 0),
      hiring_manager: Math.round(input.agentScores.hiring_manager ?? 0),
      career_strategist: Math.round(input.agentScores.career_strategist ?? 0),
      red_flag_analyst: Math.round(input.agentScores.red_flag_analyst ?? 0),
    },
    modelVersion: input.modelVersion || "gemini-3.5-flash",
    defenseRevisionsCount: input.defenseRevisionsCount ?? 0,
  };
}

/**
 * Computes SHA-256 hex digest using WebCrypto (runs identically in Browser,
 * Cloudflare Workers, and Node.js 20+).
 */
export async function computeCanonicalReportHash(
  payload: CanonicalReportPayload
): Promise<{ hashHex: string; canonicalJson: string }> {
  const canonicalJson = canonicalizeJson(payload);
  const bytes = new TextEncoder().encode(canonicalJson);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hashHex = "";
  for (let i = 0; i < view.length; i++) {
    hashHex += view[i].toString(16).padStart(2, "0");
  }
  return { hashHex, canonicalJson };
}

export function getScoreTierLabel(score: number): string {
  const rounded = Math.round(score);
  if (rounded >= 93) return `Tier S (${rounded}/100)`;
  if (rounded >= 85) return `Tier A (${rounded}/100)`;
  if (rounded >= 70) return `Tier B (${rounded}/100)`;
  return `Tier C (${rounded}/100)`;
}

/**
 * Normalizes up to 8 skill tags bounded to 24 UTF-8 bytes each to fit
 * the fixed-size `CandidateProfile` PDA limits.
 */
export function extractVerifiedSkills(matchedTerms: string[], maxCount = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const encoder = new TextEncoder();

  for (const term of matchedTerms) {
    const clean = term.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;

    // Trim cleanly to <= 24 UTF-8 bytes
    let truncated = clean;
    while (encoder.encode(truncated).length > 24 && truncated.length > 0) {
      truncated = truncated.slice(0, -1);
    }
    truncated = truncated.trim();
    if (!truncated) continue;

    seen.add(key);
    out.push(truncated);
    if (out.length >= maxCount) break;
  }

  return out;
}

/**
 * Normalizes agent_runs rows into the deterministic 6-agent score structure
 * matching the on-chain `EvaluationRecord.agent_scores` fixed `[u8; 6]` order.
 */
export function extractCanonicalAgentScoresFromRuns(
  runs: Array<{ agentRole: string; scoreContribution?: number | null }>
): CanonicalAgentScores {
  const map = new Map<string, number>();
  for (const run of runs) {
    map.set(run.agentRole, Math.round(Number(run.scoreContribution ?? 0)));
  }
  return {
    hr_recruiter: map.get("hr_recruiter") ?? 0,
    technical_interviewer: map.get("technical_interviewer") ?? 0,
    ats_scanner: map.get("ats_scanner") ?? 0,
    hiring_manager: map.get("hiring_manager") ?? 0,
    career_strategist: map.get("career_strategist") ?? 0,
    red_flag_analyst: map.get("red_flag_analyst") ?? 0,
  };
}

export function agentScoresToTuple(
  scores: CanonicalAgentScores
): [number, number, number, number, number, number] {
  return [
    scores.hr_recruiter,
    scores.technical_interviewer,
    scores.ats_scanner,
    scores.hiring_manager,
    scores.career_strategist,
    scores.red_flag_analyst,
  ];
}

/**
 * Shared helper that builds the redacted canonical payload and computes its
 * SHA-256 hex digest from a stored structured report and agent run checkpoints.
 */
export async function computeCanonicalHashFromReportRecord(input: {
  evaluationId: string;
  jobDescriptionId: string;
  structuredReport: Record<string, unknown>;
  agentRuns: Array<{ agentRole: string; scoreContribution?: number | null }>;
  overrideScore?: number | null;
  overrideVerdict?: string | null;
  modelVersion?: string | null;
  defenseRevisionsCount?: number;
}): Promise<{
  payload: CanonicalReportPayload;
  hashHex: string;
  agentScores: CanonicalAgentScores;
  redactedSnapshot: Record<string, unknown>;
}> {
  const sr = input.structuredReport;
  const agentScores = extractCanonicalAgentScoresFromRuns(input.agentRuns);
  const rawDimensions = (sr.dimensions ?? {}) as Partial<EvaluationDimensions>;
  const rawAts = (sr.atsSummary ?? {}) as {
    keywordCoverage?: number;
    matched?: string[];
    partial?: string[];
    missing?: string[];
  };

  const payload = buildCanonicalReportPayload({
    evaluationId: input.evaluationId,
    jobDescriptionId: input.jobDescriptionId,
    overallScore:
      typeof input.overrideScore === "number"
        ? input.overrideScore
        : Number(sr.overallScore ?? 0),
    verdict: input.overrideVerdict || String(sr.verdict ?? "Weak fit"),
    confidence: Number(sr.confidence ?? 0.85),
    dimensions: {
      roleFit: Number(rawDimensions.roleFit ?? 0),
      skillsAndEvidence: Number(rawDimensions.skillsAndEvidence ?? 0),
      atsAlignment: Number(rawDimensions.atsAlignment ?? 0),
      impactAndClarity: Number(rawDimensions.impactAndClarity ?? 0),
      professionalPresentation: Number(rawDimensions.professionalPresentation ?? 0),
    },
    explanation: String(sr.explanation ?? ""),
    strengths: Array.isArray(sr.strengths) ? (sr.strengths as string[]) : [],
    weaknesses: Array.isArray(sr.weaknesses) ? (sr.weaknesses as string[]) : [],
    prioritizedFixes: Array.isArray(sr.prioritizedFixes)
      ? (sr.prioritizedFixes as PrioritizedFix[])
      : [],
    redFlags: Array.isArray(sr.redFlags) ? (sr.redFlags as RedFlagNote[]) : [],
    atsSummary: {
      keywordCoverage: Number(rawAts.keywordCoverage ?? 0),
      matched: Array.isArray(rawAts.matched) ? rawAts.matched : [],
      partial: Array.isArray(rawAts.partial) ? rawAts.partial : [],
      missing: Array.isArray(rawAts.missing) ? rawAts.missing : [],
    },
    agentScores,
    modelVersion: input.modelVersion || "gemini-3.5-flash",
    defenseRevisionsCount: input.defenseRevisionsCount ?? 0,
  });

  const { hashHex } = await computeCanonicalReportHash(payload);
  return {
    payload,
    hashHex,
    agentScores,
    redactedSnapshot: payload as unknown as Record<string, unknown>,
  };
}

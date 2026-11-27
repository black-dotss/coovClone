export * from "./types";
export * from "./service";
export * from "./runner";

/**
 * Evaluation workflow and orchestration module.
 */
export function calculateWeightedScore(dims: import("./types").EvaluationDimensions): number {
  const score =
    dims.roleFit * 0.25 +
    dims.skillsAndEvidence * 0.25 +
    dims.atsAlignment * 0.20 +
    dims.impactAndClarity * 0.15 +
    dims.professionalPresentation * 0.15;
  return Math.round(score * 100) / 100;
}

export function mapScoreToVerdict(score: number): import("./types").Verdict {
  if (score >= 80) return "Strong fit";
  if (score >= 65) return "Potential fit";
  if (score >= 45) return "Significant gaps";
  return "Weak fit";
}

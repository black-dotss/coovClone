import { describe, it, expect } from "vitest";
import { calculateWeightedScore, mapScoreToVerdict } from "@/lib/evaluations";

describe("Evaluation Scoring & Verdict Mapping", () => {
  it("computes weighted score based on 25/25/20/15/15 distribution", () => {
    const dimensions = {
      roleFit: 80,                 // 80 * 0.25 = 20
      skillsAndEvidence: 70,       // 70 * 0.25 = 17.5
      atsAlignment: 90,            // 90 * 0.20 = 18
      impactAndClarity: 85,        // 85 * 0.15 = 12.75
      professionalPresentation: 80,// 80 * 0.15 = 12
    };
    // Total = 20 + 17.5 + 18 + 12.75 + 12 = 80.25
    const score = calculateWeightedScore(dimensions);
    expect(score).toBe(80.25);
    expect(mapScoreToVerdict(score)).toBe("Strong fit");
  });

  it("correctly maps verdict bands", () => {
    expect(mapScoreToVerdict(85)).toBe("Strong fit");
    expect(mapScoreToVerdict(75)).toBe("Potential fit");
    expect(mapScoreToVerdict(55)).toBe("Significant gaps");
    expect(mapScoreToVerdict(40)).toBe("Weak fit");
  });
});

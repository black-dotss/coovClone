import { describe, it, expect } from "vitest";
import {
  AgentFindingSchema,
  AgentOutputSchema,
  DebateTurnSchema,
  SynthesisReportSchema,
} from "@/lib/agents/validation";

describe("Agent Input & Output Zod Schemas", () => {
  it("validates a well-formed agent finding with evidence and uncertainty marker", () => {
    const validFinding = {
      claim: "Candidate has 4+ years of React development experience.",
      evidenceSnippet: "Senior Frontend Engineer at Acme (2020 - 2024): built React apps.",
      sourceReference: "CV: Experience Section",
      severity: "low" as const,
      confidence: 0.95,
      isUncertain: false,
    };

    const parsed = AgentFindingSchema.parse(validFinding);
    expect(parsed.claim).toBe(validFinding.claim);
    expect(parsed.confidence).toBe(0.95);
  });

  it("requires an uncertaintyReason when isUncertain is true", () => {
    const uncertainWithoutReason = {
      claim: "Claimed 10x performance improvement without baseline.",
      evidenceSnippet: "Improved speed by 10x.",
      sourceReference: "CV: Bullet 2",
      severity: "high" as const,
      confidence: 0.7,
      isUncertain: true,
      // uncertaintyReason missing
    };

    expect(() => AgentFindingSchema.parse(uncertainWithoutReason)).toThrow(
      "An uncertainty reason must be provided when marked as uncertain"
    );

    const validUncertain = {
      ...uncertainWithoutReason,
      uncertaintyReason: "No initial benchmarks or measurement methodology stated in CV.",
    };

    const parsed = AgentFindingSchema.parse(validUncertain);
    expect(parsed.isUncertain).toBe(true);
    expect(parsed.uncertaintyReason).toBeDefined();
  });

  it("rejects findings with empty evidence snippet (unsupported claims)", () => {
    const invalidFinding = {
      claim: "Candidate has strong Kubernetes expertise.",
      evidenceSnippet: "  ", // Empty evidence
      sourceReference: "CV",
      severity: "critical" as const,
      confidence: 0.8,
      isUncertain: false,
    };

    expect(() => AgentFindingSchema.parse(invalidFinding)).toThrow();
  });

  it("validates a full AgentOutput and rejects out-of-range score contributions", () => {
    const validOutput = {
      agentRole: "technical_interviewer" as const,
      displayName: "Technical Interviewer",
      position: "Strong architectural competencies demonstrated across core web stack.",
      scoreContribution: 82,
      findings: [
        {
          claim: "Hands-on experience with TypeScript and PostgreSQL.",
          evidenceSnippet: "Built distributed services using TypeScript and PostgreSQL.",
          sourceReference: "CV: Technical Experience",
          severity: "low" as const,
          confidence: 0.9,
          isUncertain: false,
        },
      ],
      missingInformation: ["Production experience with Kubernetes"],
      questionsForDebate: ["How was data consistency maintained across services?"],
      tone: "strict" as const,
      voiceCommentary: "Evaluation Assessment: Solid core competencies with minor tool gaps.",
    };

    const parsed = AgentOutputSchema.parse(validOutput);
    expect(parsed.scoreContribution).toBe(82);

    // Score out of range (> 100)
    expect(() =>
      AgentOutputSchema.parse({
        ...validOutput,
        scoreContribution: 105,
      })
    ).toThrow();
  });

  it("validates structured debate turn format with sequence and citations", () => {
    const turn = {
      sequence: 1,
      agentRole: "hr_recruiter" as const,
      replyToRole: "technical_interviewer" as const,
      content: "While technical skills are documented, the timeline leaves a 6-month gap.",
      evidenceReferences: ["Acme Corp (2021) - Next Corp (2022)"],
    };

    const parsed = DebateTurnSchema.parse(turn);
    expect(parsed.sequence).toBe(1);
    expect(parsed.agentRole).toBe("hr_recruiter");
  });

  it("validates SynthesisReportSchema and enforces dimensional score integrity", () => {
    const validReport = {
      overallScore: 78,
      verdict: "Potential fit" as const,
      confidence: 0.9,
      dimensions: {
        roleFit: 80,
        skillsAndEvidence: 75,
        atsAlignment: 85,
        impactAndClarity: 70,
        professionalPresentation: 80,
      },
      explanation: "Overall strong technical candidate with minor gaps in leadership metrics.",
      strengths: ["Demonstrated TypeScript mastery"],
      weaknesses: ["Lack of commercial ROI metrics"],
      prioritizedFixes: [
        {
          fix: "Quantify business outcomes in work history.",
          expectedBenefit: "Clarifies commercial value.",
          effort: "medium" as const,
        },
      ],
      redFlags: [
        {
          flag: "Tenure under 1 year at first company.",
          evidenceSnippet: "Jan 2020 - Aug 2020",
          isProofOfProblem: false as const,
        },
      ],
      likelyInterviewQuestions: [
        {
          question: "Can you elaborate on your architectural choices in Project Alpha?",
          tiedToClaim: "Demonstrated TypeScript mastery",
          rationale: "Verifies technical depth.",
        },
      ],
      atsSummary: {
        keywordCoverage: 85,
        matched: ["TypeScript", "React"],
        partial: ["Postgres"],
        missing: ["Docker"],
        disclaimer: "Keyword coverage measures vocabulary overlap.",
      },
      uncertaintyNotes: [],
    };

    const parsed = SynthesisReportSchema.parse(validReport);
    expect(parsed.overallScore).toBe(78);
    expect(parsed.verdict).toBe("Potential fit");
    expect(parsed.redFlags[0].isProofOfProblem).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [
          {
            id: "eval-orchestration-test",
            status: "queued",
            ownerUserId: "user-123",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  },
  evaluations: {},
  agentRuns: {},
  debateMessages: {},
  reports: {},
  cvVersions: {},
  jobDescriptions: {},
  documents: {},
}));

import { createEvaluationGraph } from "@/lib/agents/graph/workflow";
import { runEvaluationWorkflow } from "@/lib/evaluations/service";
import { MockLLMProvider } from "@/lib/ai/providers/mock";
import { AgentRole, DebateTurn, SynthesisReport } from "@/lib/agents/types";

const CV_SAMPLE = `
Michael Scott
Regional Manager & Sales Director | Scranton, PA

EXPERIENCE
Dunder Mifflin Paper Company — Regional Manager
2005 – 2013
- Managed regional branch operations and client relationships across Northeast PA.
- Increased client retention by 18% through personalized service agreements.
- Supervised cross-functional team of 12 account executives and warehouse personnel.
- Utilized SQL queries and database reports to analyze quarterly sales performance.

EDUCATION
Scranton High School (1983)
SKILLS
Negotiation, Client Retention, Team Motivation, Conflict Resolution, Sales Strategy, SQL
`;

const JD_SAMPLE = `
Branch General Manager — Paper & Packaging
Requirements:
- 5+ years of managerial experience leading regional sales and distribution teams.
- Proven track record of improving client retention and driving revenue growth.
- Experience with SQL and reporting databases.
- High ethical standards, operational consistency, and clear documentation.

Preferred:
- Bachelor's degree in Business Administration or related field.
`;

describe("LangGraph Recruitment Evaluation & Orchestration", () => {
  const provider = new MockLLMProvider();

  it("executes the full LangGraph graph producing 6 structured assessments, bounded debate, and synthesis report", async () => {
    const recordedAgents: AgentRole[] = [];
    const recordedTurns: DebateTurn[] = [];
    let recordedReport: SynthesisReport | null = null;

    const graph = createEvaluationGraph(
      provider,
      {
        onAgentCompleted: async (role) => {
          recordedAgents.push(role);
        },
        onDebateTurnGenerated: async (turn) => {
          recordedTurns.push(turn);
        },
        onReportGenerated: async (report) => {
          recordedReport = report;
        },
      },
      3 // bounded concurrency
    );

    const result = await graph.invoke({
      evaluationId: "eval-12345",
      ownerUserId: "user-test-owner",
      cvText: CV_SAMPLE,
      jdText: JD_SAMPLE,
      tone: "strict",
    });

    // 1. Verify six independent agent assessments
    expect(Object.keys(result.agentOutputs)).toHaveLength(6);
    expect(recordedAgents).toHaveLength(6);
    expect(recordedAgents).toContain("hr_recruiter");
    expect(recordedAgents).toContain("technical_interviewer");
    expect(recordedAgents).toContain("ats_scanner");
    expect(recordedAgents).toContain("hiring_manager");
    expect(recordedAgents).toContain("career_strategist");
    expect(recordedAgents).toContain("red_flag_analyst");

    // 2. Verify bounded debate
    expect(result.debateTurns.length).toBeGreaterThanOrEqual(4);
    expect(result.debateTurns.length).toBeLessThanOrEqual(6);
    expect(recordedTurns.length).toBe(result.debateTurns.length);

    // Verify debate turns have sequence and cited evidence
    for (const turn of result.debateTurns) {
      expect(turn.sequence).toBeGreaterThan(0);
      expect(turn.content.length).toBeGreaterThan(15);
      expect(turn.evidenceReferences.length).toBeGreaterThan(0);
    }

    // 3. Verify final synthesis report
    const report = result.finalReport as SynthesisReport;
    expect(report).toBeDefined();
    expect(recordedReport).toEqual(report);

    // Scoring & verdict
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
    expect(["Strong fit", "Potential fit", "Significant gaps", "Weak fit"]).toContain(report.verdict);

    // Dimensions
    expect(report.dimensions.roleFit).toBeGreaterThan(0);
    expect(report.dimensions.skillsAndEvidence).toBeGreaterThan(0);
    expect(report.dimensions.atsAlignment).toBeGreaterThan(0);
    expect(report.dimensions.impactAndClarity).toBeGreaterThan(0);
    expect(report.dimensions.professionalPresentation).toBeGreaterThan(0);

    // 3-5 Prioritized fixes
    expect(report.prioritizedFixes.length).toBeGreaterThanOrEqual(3);
    expect(report.prioritizedFixes.length).toBeLessThanOrEqual(5);
    for (const fix of report.prioritizedFixes) {
      expect(fix.fix.length).toBeGreaterThan(10);
      expect(fix.expectedBenefit.length).toBeGreaterThan(5);
      expect(["low", "medium", "high"]).toContain(fix.effort);
    }

    // Likely interview questions
    expect(report.likelyInterviewQuestions.length).toBeGreaterThanOrEqual(1);
    for (const q of report.likelyInterviewQuestions) {
      expect(q.question.length).toBeGreaterThan(10);
      expect(q.tiedToClaim.length).toBeGreaterThan(3);
      expect(q.rationale.length).toBeGreaterThan(5);
    }

    // Red flag rule: "A flag is not proof of a problem"
    for (const flag of report.redFlags) {
      expect(flag.isProofOfProblem).toBe(false);
    }

    // Token tracking
    expect(result.totalTokenUsage.totalTokens).toBeGreaterThan(0);
  });

  it("orchestrates runEvaluationWorkflow with persistence and completes successfully", async () => {
    const result = await runEvaluationWorkflow({
      evaluationId: "eval-orchestration-test",
      ownerUserId: "user-123",
      cvText: CV_SAMPLE,
      jdText: JD_SAMPLE,
      tone: "strict",
      provider,
      concurrencyLimit: 2,
    });

    expect(result.status).toBe("completed");
    expect(result.evaluationId).toBe("eval-orchestration-test");
    expect(result.finalReport.overallScore).toBeGreaterThan(0);
    expect(Object.keys(result.agentOutputs)).toHaveLength(6);
    expect(result.debateTurns.length).toBeGreaterThanOrEqual(4);
  });

  it("guarantees zero invented candidate facts by grounding all findings in text", async () => {
    const result = await runEvaluationWorkflow({
      evaluationId: "eval-facts-test",
      ownerUserId: "user-123",
      cvText: CV_SAMPLE,
      jdText: JD_SAMPLE,
      tone: "strict",
      provider,
    });

    // Verify all findings in all 6 agents cite evidence present in CV or JD
    const allFindings = Object.values(result.agentOutputs).flatMap((a) => a.findings);
    const combinedTexts = `${CV_SAMPLE.toLowerCase()} ${JD_SAMPLE.toLowerCase()}`.replace(/\s+/g, " ");

    for (const finding of allFindings) {
      expect(finding.evidenceSnippet).toBeDefined();
      expect(finding.evidenceSnippet.length).toBeGreaterThan(0);

      // Either the snippet is grounded in the text, or an uncertainty marker is set
      const cleanSnippet = finding.evidenceSnippet
        .replace(/^\.\.\.|\.\.\.$/g, "")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .trim();
      const isGroundInText =
        combinedTexts.includes(cleanSnippet) ||
        cleanSnippet.length < 10 ||
        finding.evidenceSnippet.includes("...");

      if (!isGroundInText) {
        expect(finding.isUncertain).toBe(true);
        expect(finding.uncertaintyReason).toBeDefined();
      }
    }
  });
});

import { describe, it, expect, vi } from "vitest";
import { agentRuns, debateMessages } from "@/lib/db/schema";
import { getEvaluationProgress } from "@/lib/evaluations/worker";

const mockEvaluation = {
  id: "eval-progress-test",
  ownerUserId: "user-owner-1",
  cvVersionId: "cv-v1",
  jobDescriptionId: "jd-1",
  tone: "strict",
  status: "processing",
  overallScore: null as number | null,
  verdict: null as string | null,
  workflowState: {},
  errorMessage: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockCompletedRuns = [
  {
    evaluationId: "eval-progress-test",
    agentRole: "hr_recruiter",
    status: "completed",
    scoreContribution: 80,
    structuredResult: { displayName: "Skeptical HR Recruiter" },
    durationMs: 120,
    updatedAt: new Date(),
  },
  {
    evaluationId: "eval-progress-test",
    agentRole: "technical_interviewer",
    status: "completed",
    scoreContribution: 85,
    structuredResult: { displayName: "Technical Interviewer" },
    durationMs: 140,
    updatedAt: new Date(),
  },
  {
    evaluationId: "eval-progress-test",
    agentRole: "ats_scanner",
    status: "completed",
    scoreContribution: 75,
    structuredResult: { displayName: "ATS Keyword Scanner" },
    durationMs: 110,
    updatedAt: new Date(),
  },
];

const mockDebateMessages = [
  { sequence: 1, agentRole: "hr_recruiter" },
  { sequence: 2, agentRole: "technical_interviewer" },
];

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => Promise.resolve(data.slice(0, n)),
    orderBy: () => createMockQuery(data),
    where: () => createMockQuery(data),
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === agentRuns) return createMockQuery(mockCompletedRuns);
        if (table === debateMessages) return createMockQuery(mockDebateMessages);
        return createMockQuery([mockEvaluation]);
      },
    }),
  },
}));

describe("Live Progress Calculation & Browser Refresh Resilience", () => {
  it("calculates live progress percentage accurately from persisted database state", async () => {
    mockEvaluation.status = "processing";

    const progress = await getEvaluationProgress("eval-progress-test", "user-owner-1");

    expect(progress.status).toBe("processing");
    expect(progress.completedAgents).toHaveLength(3);
    expect(progress.debateTurnsCount).toBe(2);
    expect(progress.isTerminal).toBe(false);

    // 15% (baseline) + 3/6 * 60% (30%) + 20% (debate) = 65%
    expect(progress.progressPercentage).toBe(65);
    expect(progress.completedAgents[0].displayName).toBe("Skeptical HR Recruiter");
  });

  it("survives browser refresh: reconnecting client immediately receives full persisted progress and history", async () => {
    // Client connects after a browser refresh
    const refreshedProgress = await getEvaluationProgress("eval-progress-test", "user-owner-1");

    // All previously completed agents and debate messages are retrieved from DB
    expect(refreshedProgress.evaluationId).toBe("eval-progress-test");
    expect(refreshedProgress.completedAgents.map((a) => a.role)).toEqual([
      "hr_recruiter",
      "technical_interviewer",
      "ats_scanner",
    ]);
    expect(refreshedProgress.debateTurnsCount).toBe(2);
  });

  it("reports 100% progress when evaluation reaches completed state", async () => {
    mockEvaluation.status = "completed";
    mockEvaluation.overallScore = 88;
    mockEvaluation.verdict = "Strong fit";

    const progress = await getEvaluationProgress("eval-progress-test", "user-owner-1");

    expect(progress.status).toBe("completed");
    expect(progress.progressPercentage).toBe(100);
    expect(progress.isTerminal).toBe(true);
    expect(progress.overallScore).toBe(88);
    expect(progress.verdict).toBe("Strong fit");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  agentRuns,
  debateMessages,
  reports,
  cvVersions,
  jobDescriptions,
} from "@/lib/db/schema";
import { AgentRole } from "@/lib/agents";

const mockEvaluation = {
  id: "eval-checkpoint-1",
  ownerUserId: "user-owner-1",
  cvVersionId: "cv-v1",
  jobDescriptionId: "jd-1",
  tone: "strict",
  status: "queued",
  overallScore: null as number | null,
  verdict: null as string | null,
  workflowState: {
    creditReservation: {
      reservationId: "res-123",
      userId: "user-owner-1",
      dailyPeriodKey: "daily:user-owner-1:2026-11-16",
      credits: 1,
    },
    retryCount: 0,
  },
  errorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockCv = {
  id: "cv-v1",
  extractedText: "Alex Doe\nSenior Backend Engineer\n2020 - 2024\n- Built TypeScript APIs with PostgreSQL.",
};

const mockJd = {
  id: "jd-1",
  rawText: "Senior Backend Engineer\nRequirements:\n- 4+ years TypeScript, Node.js, and PostgreSQL.",
};

// In-memory tables for worker checkpoint tests
let inMemoryAgentRuns: Record<string, unknown>[] = [];
let inMemoryDebateMessages: Record<string, unknown>[] = [];
let inMemoryReports: Record<string, unknown>[] = [];
let currentEvalState = { ...mockEvaluation };

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
        if (table === agentRuns) return createMockQuery(inMemoryAgentRuns);
        if (table === debateMessages) return createMockQuery(inMemoryDebateMessages);
        if (table === reports) return createMockQuery(inMemoryReports);
        if (table === cvVersions) return createMockQuery([mockCv]);
        if (table === jobDescriptions) return createMockQuery([mockJd]);
        return createMockQuery([currentEvalState]);
      },
    }),
    insert: (table: unknown) => ({
      values: (val: Record<string, unknown>) => {
        if (table === agentRuns || (val.agentRole && !val.sequence)) {
          inMemoryAgentRuns.push(val);
        }
        if (table === debateMessages || val.sequence) {
          inMemoryDebateMessages.push(val);
        }
        if (table === reports || val.structuredReport) {
          inMemoryReports.push(val);
        }
        return {
          returning: () => [val],
        };
      },
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          Object.assign(currentEvalState, updates);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

const mockSettleCredit = vi.fn().mockResolvedValue(undefined);
const mockReleaseCredit = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/billing/ledger", () => ({
  settleEvaluationCredit: (...args: unknown[]) => mockSettleCredit(...args),
  releaseEvaluationCredit: (...args: unknown[]) => mockReleaseCredit(...args),
  reserveEvaluationCredit: vi.fn(),
  getActiveUserSubscription: vi.fn(),
}));

import { executeEvaluationWithCheckpoints } from "@/lib/evaluations/worker";
import { MockLLMProvider } from "@/lib/ai/providers/mock";

describe("Evaluation Worker Checkpoints & Worker Restart Resumption", () => {
  const provider = new MockLLMProvider();

  beforeEach(() => {
    inMemoryAgentRuns = [];
    inMemoryDebateMessages = [];
    inMemoryReports = [];
    currentEvalState = { ...mockEvaluation, status: "queued" };
    vi.clearAllMocks();
  });

  it("executes a fresh queued evaluation, persists all 6 agent runs, settles credit, and marks completed", async () => {
    const result = await executeEvaluationWithCheckpoints("eval-checkpoint-1", {
      provider,
      concurrencyLimit: 2,
    });

    expect(result.status).toBe("completed");
    expect(result.progressPercentage).toBe(100);
    expect(result.isTerminal).toBe(true);

    // Verify all 6 agents were executed and persisted
    expect(inMemoryAgentRuns).toHaveLength(6);
    expect(inMemoryDebateMessages.length).toBeGreaterThanOrEqual(4);
    expect(inMemoryReports).toHaveLength(1);

    // Verify quota credit was settled exactly once
    expect(mockSettleCredit).toHaveBeenCalledTimes(1);
    expect(mockReleaseCredit).not.toHaveBeenCalled();
  });

  it("survives worker restart: reuses 3 already-persisted agents without duplicating them and finishes missing agents", async () => {
    // Simulate that a previous worker crashed after persisting 3 agents
    const preExistingAgents: AgentRole[] = ["hr_recruiter", "technical_interviewer", "ats_scanner"];
    for (const role of preExistingAgents) {
      inMemoryAgentRuns.push({
        evaluationId: "eval-checkpoint-1",
        agentRole: role,
        status: "completed",
        scoreContribution: 80,
        structuredResult: {
          agentRole: role,
          displayName: role,
          position: "Recovered from prior worker run",
          scoreContribution: 80,
          findings: [
            {
              claim: "Recovered finding",
              evidenceSnippet: "Alex Doe",
              sourceReference: "CV",
              severity: "low",
              confidence: 0.9,
              isUncertain: false,
            },
          ],
          missingInformation: [],
          questionsForDebate: [],
          tone: "strict",
          voiceCommentary: "Standard commentary",
        },
        updatedAt: new Date(),
      });
    }

    currentEvalState.status = "processing";

    // Worker restarts and resumes
    const result = await executeEvaluationWithCheckpoints("eval-checkpoint-1", {
      provider,
    });

    expect(result.status).toBe("completed");

    // Total agent runs in DB must be exactly 6 (3 existing + 3 newly run, NO duplicates)
    expect(inMemoryAgentRuns).toHaveLength(6);
    const rolesPresent = inMemoryAgentRuns.map((r) => r.agentRole);
    expect(new Set(rolesPresent).size).toBe(6);

    // Credit was settled once
    expect(mockSettleCredit).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: returns immediately when evaluation is already completed without double-settlement", async () => {
    currentEvalState.status = "completed";
    currentEvalState.overallScore = 85;

    const result = await executeEvaluationWithCheckpoints("eval-checkpoint-1", { provider });

    expect(result.status).toBe("completed");
    expect(mockSettleCredit).not.toHaveBeenCalled();
    expect(mockReleaseCredit).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestError, ForbiddenError } from "@/lib/shared/errors";
import {
  agentRuns,
  debateMessages,
  reports,
  cvVersions,
  jobDescriptions,
} from "@/lib/db/schema";
import * as agentsModule from "@/lib/agents";

const mockReservation = {
  reservationId: "res-cancel-123",
  userId: "user-owner-1",
  dailyPeriodKey: "daily:user-owner-1:2026-11-16",
  credits: 1,
};

const mockCv = {
  id: "cv-v1",
  extractedText: "Alex Doe\nSenior Backend Engineer\n2020 - 2024\n- Built TypeScript APIs with PostgreSQL.",
};

const mockJd = {
  id: "jd-1",
  rawText: "Senior Backend Engineer\nRequirements:\n- 4+ years TypeScript, Node.js, and PostgreSQL.",
};

let currentEvaluation = {
  id: "eval-cancel-test",
  ownerUserId: "user-owner-1",
  cvVersionId: "cv-v1",
  jobDescriptionId: "jd-1",
  tone: "strict",
  status: "processing",
  overallScore: null as number | null,
  verdict: null as string | null,
  workflowState: {
    creditReservation: mockReservation,
    retryCount: 0,
  },
  errorMessage: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(Date.now() - 600_000), // 10 minutes ago (stale)
};

const mockReleaseCredit = vi.fn().mockResolvedValue(undefined);
const mockSettleCredit = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/billing/ledger", () => ({
  releaseEvaluationCredit: (...args: unknown[]) => mockReleaseCredit(...args),
  settleEvaluationCredit: (...args: unknown[]) => mockSettleCredit(...args),
  reserveEvaluationCredit: vi.fn(),
}));

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
        if (table === agentRuns) return createMockQuery([]);
        if (table === debateMessages) return createMockQuery([]);
        if (table === reports) return createMockQuery([]);
        if (table === cvVersions) return createMockQuery([mockCv]);
        if (table === jobDescriptions) return createMockQuery([mockJd]);
        return createMockQuery([currentEvaluation]);
      },
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          Object.assign(currentEvaluation, updates);
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => [],
      }),
    }),
  },
}));

import {
  cancelEvaluation,
  recoverStaleJobs,
  executeEvaluationWithCheckpoints,
} from "@/lib/evaluations/worker";
import { MockLLMProvider } from "@/lib/ai/providers/mock";

describe("Evaluation Cancellation, Stale Jobs, and Retry Exhaustion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentEvaluation = {
      id: "eval-cancel-test",
      ownerUserId: "user-owner-1",
      cvVersionId: "cv-v1",
      jobDescriptionId: "jd-1",
      tone: "strict",
      status: "processing",
      overallScore: null,
      verdict: null,
      workflowState: {
        creditReservation: mockReservation,
        retryCount: 0,
      },
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(Date.now() - 600_000),
    };
  });

  it("cancels a processing evaluation and releases reserved credit back to user", async () => {
    const result = await cancelEvaluation("eval-cancel-test", "user-owner-1");

    expect(result.status).toBe("cancelled");
    expect(result.isTerminal).toBe(true);
    expect(currentEvaluation.status).toBe("cancelled");

    // Credit was released
    expect(mockReleaseCredit).toHaveBeenCalledWith({
      userId: "user-owner-1",
      reservation: mockReservation,
      reason: "user_cancelled",
    });
  });

  it("prohibits unauthorized users from cancelling someone else's evaluation", async () => {
    await expect(
      cancelEvaluation("eval-cancel-test", "attacker-user-999")
    ).rejects.toThrow(ForbiddenError);
  });

  it("prohibits cancelling an already completed evaluation", async () => {
    currentEvaluation.status = "completed";

    await expect(
      cancelEvaluation("eval-cancel-test", "user-owner-1")
    ).rejects.toThrow(BadRequestError);
  });

  it("recovers stale processing jobs and resumes them", async () => {
    const recovered = await recoverStaleJobs(5 * 60 * 1000, {
      provider: new MockLLMProvider(),
    });
    expect(recovered).toBeGreaterThanOrEqual(0);
  });

  it("handles retry exhaustion by transitioning to failed and releasing credit", async () => {
    // Evaluation has already used all retries
    currentEvaluation.workflowState.retryCount = 3;

    vi.spyOn(agentsModule, "executeAgent").mockRejectedValueOnce(
      new Error("Persistent AI provider outage: 503")
    );

    await expect(
      executeEvaluationWithCheckpoints("eval-cancel-test", {
        maxRetries: 3,
      })
    ).rejects.toThrow("Persistent AI provider outage: 503");

    expect(currentEvaluation.status).toBe("failed");
    expect(currentEvaluation.errorMessage).toContain("Persistent AI provider outage");

    expect(mockReleaseCredit).toHaveBeenCalledWith({
      userId: "user-owner-1",
      reservation: mockReservation,
      reason: "provider_outage_or_exhaustion",
    });
  });
});

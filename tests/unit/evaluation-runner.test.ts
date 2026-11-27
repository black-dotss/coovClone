import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db
vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(),
      update: vi.fn(),
    },
    evaluations: {
      id: "id",
      status: "status",
      updatedAt: "updatedAt",
      ownerUserId: "ownerUserId",
    },
  };
});

// Mock worker
vi.mock("@/lib/evaluations/worker", () => {
  return {
    executeEvaluationWithCheckpoints: vi.fn().mockResolvedValue({
      status: "completed",
      isTerminal: true,
      overallScore: 85,
    }),
    getEvaluationProgress: vi.fn().mockResolvedValue({
      status: "completed",
      isTerminal: true,
      overallScore: 85,
    }),
  };
});

import { db } from "@/lib/db";
import { executeEvaluationWithCheckpoints } from "@/lib/evaluations/worker";
import { dispatchEvaluationExecution, isEvaluationExecuting } from "@/lib/evaluations/runner";

describe("Evaluation Runner Dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should dispatch execution for queued evaluation and register waitUntil", async () => {
    const mockWaitUntil = vi.fn();

    // Mock select returning queued evaluation
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          {
            id: "eval-test-1",
            status: "queued",
            updatedAt: new Date(),
            ownerUserId: "user-1",
          },
        ]),
      }),
    });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

    // Mock update
    const mockSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });
    vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

    const promise = dispatchEvaluationExecution("eval-test-1", {
      waitUntil: mockWaitUntil,
    });

    expect(promise).not.toBeNull();
    expect(mockWaitUntil).toHaveBeenCalled();

    const result = await promise;
    expect(result?.status).toBe("completed");
    expect(executeEvaluationWithCheckpoints).toHaveBeenCalledWith("eval-test-1", expect.objectContaining({
      concurrencyLimit: 6,
    }));
  });

  it("should return completed progress if evaluation is already terminal without executing", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          {
            id: "eval-test-done",
            status: "completed",
            updatedAt: new Date(),
            ownerUserId: "user-1",
          },
        ]),
      }),
    });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

    const result = await dispatchEvaluationExecution("eval-test-done");
    expect(result?.status).toBe("completed");
    expect(executeEvaluationWithCheckpoints).not.toHaveBeenCalled();
  });

  it("should reuse active promise for concurrent calls with same evaluation ID", async () => {
    let resolveExecution: (val: any) => void;
    const delayedPromise = new Promise((resolve) => {
      resolveExecution = resolve;
    });
    vi.mocked(executeEvaluationWithCheckpoints).mockImplementationOnce(() => delayedPromise as any);

    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          {
            id: "eval-concurrent-1",
            status: "queued",
            updatedAt: new Date(),
            ownerUserId: "user-1",
          },
        ]),
      }),
    });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

    const mockSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });
    vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

    const call1Promise = dispatchEvaluationExecution("eval-concurrent-1");
    expect(isEvaluationExecuting("eval-concurrent-1")).toBe(true);

    const call2Promise = dispatchEvaluationExecution("eval-concurrent-1");

    // Release the worker execution
    resolveExecution!({ status: "completed", isTerminal: true, overallScore: 88 });

    const [res1, res2] = await Promise.all([call1Promise, call2Promise]);

    // Both calls must return identical result
    expect(res1).toEqual(res2);
    expect(executeEvaluationWithCheckpoints).toHaveBeenCalledTimes(1);
    expect(isEvaluationExecuting("eval-concurrent-1")).toBe(false);
  });
});

import { db, evaluations } from "@/lib/db";
import { eq } from "drizzle-orm";
import { executeEvaluationWithCheckpoints, WorkerExecutionOptions, getEvaluationProgress } from "./worker";
import { EvaluationProgress } from "./types";
import { logger } from "@/lib/shared/logger";

/**
 * Tracks in-flight evaluation promises within the current worker instance
 * to prevent duplicate concurrent executions for the same evaluation ID.
 */
const activeExecutions = new Map<string, Promise<EvaluationProgress | null>>();

/**
 * Safely resolves Cloudflare Worker execution context waitUntil function if present in the global scope.
 */
function getCloudflareWaitUntil(): ((p: Promise<unknown>) => void) | null {
  try {
    const cfContext = (globalThis as Record<symbol, unknown>)[
      Symbol.for("__cloudflare-context__")
    ] as { ctx?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

    if (cfContext?.ctx?.waitUntil && typeof cfContext.ctx.waitUntil === "function") {
      return (p: Promise<unknown>) => cfContext.ctx!.waitUntil!(p);
    }
  } catch {
    // Cloudflare context unavailable in local Node environment or static phases
  }
  return null;
}

export interface DispatchOptions {
  waitUntil?: (p: Promise<unknown>) => void;
  force?: boolean;
  workerOptions?: WorkerExecutionOptions;
}

/**
 * Dispatches evaluation execution with idempotency, single-flight deduplication,
 * and seamless background processing across both Node.js and Cloudflare Workers.
 */
export async function dispatchEvaluationExecution(
  evaluationId: string,
  options?: DispatchOptions
): Promise<EvaluationProgress | null> {
  // 1. In-memory single-flight deduplication (synchronous check)
  const existingPromise = activeExecutions.get(evaluationId);
  if (existingPromise) {
    logger.info("Evaluation execution already active in memory; returning in-flight promise", {
      evaluationId,
    });
    return existingPromise;
  }

  // 2. Wrap execution pipeline
  const executionPipeline = (async () => {
    // Fetch evaluation state from database
    const [current] = await db
      .select({
        id: evaluations.id,
        status: evaluations.status,
        updatedAt: evaluations.updatedAt,
        ownerUserId: evaluations.ownerUserId,
      })
      .from(evaluations)
      .where(eq(evaluations.id, evaluationId))
      .limit(1);

    if (!current) {
      logger.warn("Cannot dispatch evaluation: record not found", { evaluationId });
      return null;
    }

    // If already finished or cancelled, no work needed
    if (
      current.status === "completed" ||
      current.status === "failed" ||
      current.status === "cancelled"
    ) {
      return getEvaluationProgress(evaluationId, current.ownerUserId);
    }

    // Check staleness if already processing: stale after 45 seconds without heartbeat update
    const isStale =
      current.status === "processing" &&
      Date.now() - new Date(current.updatedAt).getTime() > 45_000;

    if (current.status === "processing" && !isStale && !options?.force) {
      logger.info("Evaluation is actively processing with fresh heartbeat; skipping duplicate dispatch", {
        evaluationId,
        updatedAt: current.updatedAt,
      });
      return getEvaluationProgress(evaluationId, current.ownerUserId);
    }

    // Atomically update status to processing and touch updatedAt
    await db
      .update(evaluations)
      .set({
        status: "processing",
        updatedAt: new Date(),
      })
      .where(eq(evaluations.id, evaluationId));

    logger.info("Starting evaluation execution via runner", {
      evaluationId,
      previousStatus: current.status,
      isStale,
    });

    // Execute with checkpoints
    return await executeEvaluationWithCheckpoints(evaluationId, {
      concurrencyLimit: options?.workerOptions?.concurrencyLimit ?? 6,
      provider: options?.workerOptions?.provider,
      maxRetries: options?.workerOptions?.maxRetries ?? 3,
    });
  })();

  // Synchronously register in active executions map before any async tick
  activeExecutions.set(
    evaluationId,
    executionPipeline.finally(() => {
      activeExecutions.delete(evaluationId);
    })
  );

  // Cloudflare Workers waitUntil integration or Node unhandled rejection guard
  const waitUntil = options?.waitUntil ?? getCloudflareWaitUntil();
  if (waitUntil) {
    try {
      waitUntil(
        executionPipeline.catch((err) => {
          logger.error("Cloudflare waitUntil execution caught error", {
            evaluationId,
            error: err instanceof Error ? err.message : String(err),
          });
        })
      );
    } catch (wuErr) {
      logger.warn("Failed registering promise with Cloudflare waitUntil", {
        evaluationId,
        error: String(wuErr),
      });
    }
  } else {
    executionPipeline.catch((err) => {
      logger.error("Background evaluation execution caught error", {
        evaluationId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return executionPipeline;
}

/**
 * Checks if an evaluation is currently executing in memory within this worker process.
 */
export function isEvaluationExecuting(evaluationId: string): boolean {
  return activeExecutions.has(evaluationId);
}

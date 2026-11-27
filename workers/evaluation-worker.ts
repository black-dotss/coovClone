import { db, evaluations } from "@/lib/db";
import { eq } from "drizzle-orm";
import { executeEvaluationWithCheckpoints, recoverStaleJobs } from "@/lib/evaluations/worker";
import { logger } from "@/lib/shared/logger";

export interface WorkerOptions {
  pollIntervalMs?: number;
  concurrencyLimit?: number;
  staleThresholdMs?: number;
  runOnce?: boolean;
}

/**
 * Background worker process that continuously polls the database for queued
 * and stale evaluations, executing LangGraph workflows with checkpoints and retries.
 */
export async function startEvaluationWorker(options?: WorkerOptions): Promise<void> {
  const pollIntervalMs = options?.pollIntervalMs ?? 3000;
  const staleThresholdMs = options?.staleThresholdMs ?? 300_000;
  let isRunning = true;

  logger.info("Starting CookMyCv Evaluation Background Worker", {
    pollIntervalMs,
    staleThresholdMs,
  });

  const shutdown = () => {
    logger.info("Received termination signal; shutting down evaluation worker");
    isRunning = false;
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (isRunning) {
    try {
      // 1. Recover any stale jobs that stalled due to previous worker crashes
      await recoverStaleJobs(staleThresholdMs);

      // 2. Poll for next queued evaluation
      const [queuedJob] = await db
        .select({ id: evaluations.id })
        .from(evaluations)
        .where(eq(evaluations.status, "queued"))
        .limit(1);

      if (queuedJob) {
        logger.info(`Worker picked up queued evaluation ${queuedJob.id}`);
        await executeEvaluationWithCheckpoints(queuedJob.id, {
          concurrencyLimit: options?.concurrencyLimit ?? 6,
        });
      }
    } catch (err) {
      logger.error("Error in background worker polling cycle", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (options?.runOnce) {
      break;
    }

    if (isRunning) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  logger.info("Evaluation Background Worker stopped");
}

// Allow direct CLI execution if run with node/tsx
if (typeof require !== "undefined" && require.main === module) {
  startEvaluationWorker().catch((err) => {
    logger.error("Fatal error in evaluation worker process", { error: err });
    process.exit(1);
  });
}

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  documents,
  evaluations,
  subscriptions,
  paymentOrders,
} from "@/lib/db/schema";
import { count, isNull, isNotNull } from "drizzle-orm";
import { ErrorReport, SystemMetrics } from "./types";
import { rateLimiter } from "./rate-limiter";
import { AppError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import { recordAuditEvent } from "./audit";

/**
 * Standard error capture and incident reporting helper.
 */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>
): ErrorReport {
  const isAppErr = err instanceof AppError;
  const isStdErr = err instanceof Error;

  const errorReport: ErrorReport = {
    id: `err-${randomUUID()}`,
    name: isStdErr ? err.name : "UnknownError",
    message: isStdErr ? err.message : String(err),
    code: isAppErr ? err.code : undefined,
    statusCode: isAppErr ? err.statusCode : 500,
    stack: isStdErr ? err.stack : undefined,
    context,
    timestamp: new Date(),
  };

  logger.error("Captured Exception Incident", {
    incidentId: errorReport.id,
    name: errorReport.name,
    message: errorReport.message,
    statusCode: errorReport.statusCode,
    code: errorReport.code,
    context,
  });

  // Log audit event asynchronously
  recordAuditEvent({
    action: "system.error_captured",
    targetType: "incident",
    targetId: errorReport.id,
    metadata: {
      name: errorReport.name,
      message: errorReport.message,
      statusCode: errorReport.statusCode,
      code: errorReport.code,
      ...context,
    },
  }).catch((auditErr) => {
    logger.warn("Failed to record error audit event", { auditErr: String(auditErr) });
  });

  return errorReport;
}

/**
 * Aggregates operational telemetry and system health metrics.
 */
export async function getSystemMetrics(): Promise<SystemMetrics> {
  const [activeDocs] = await db
    .select({ value: count() })
    .from(documents)
    .where(isNull(documents.deletedAt));

  const [softDeletedDocs] = await db
    .select({ value: count() })
    .from(documents)
    .where(isNotNull(documents.deletedAt));

  const evalCounts = await db
    .select({ status: evaluations.status, count: count() })
    .from(evaluations)
    .groupBy(evaluations.status);

  const evalMap: Record<string, number> = {};
  for (const row of evalCounts) {
    evalMap[row.status] = row.count;
  }

  const subCounts = await db
    .select({ status: subscriptions.status, planId: subscriptions.planId, count: count() })
    .from(subscriptions)
    .groupBy(subscriptions.status, subscriptions.planId);

  let activeSubs = 0;
  let totalSubs = 0;
  const subsByTier: Record<string, number> = {};

  for (const row of subCounts) {
    totalSubs += row.count;
    if (row.status === "active") {
      activeSubs += row.count;
      subsByTier[row.planId] = (subsByTier[row.planId] || 0) + row.count;
    }
  }

  const orderCounts = await db
    .select({ status: paymentOrders.status, count: count() })
    .from(paymentOrders)
    .groupBy(paymentOrders.status);

  const orderMap: Record<string, number> = {};
  let totalOrders = 0;
  for (const row of orderCounts) {
    orderMap[row.status] = row.count;
    totalOrders += row.count;
  }

  const abuse = rateLimiter.getMetrics();

  return {
    timestamp: new Date(),
    documents: {
      total: (activeDocs?.value ?? 0) + (softDeletedDocs?.value ?? 0),
      active: activeDocs?.value ?? 0,
      softDeleted: softDeletedDocs?.value ?? 0,
    },
    evaluations: {
      total: Object.values(evalMap).reduce((a, b) => a + b, 0),
      completed: evalMap["completed"] ?? 0,
      queued: evalMap["queued"] ?? 0,
      processing: evalMap["processing"] ?? 0,
      failed: evalMap["failed"] ?? 0,
      cancelled: evalMap["cancelled"] ?? 0,
    },
    subscriptions: {
      total: totalSubs,
      active: activeSubs,
      byTier: subsByTier,
    },
    payments: {
      totalOrders,
      verified: orderMap["verified"] ?? 0,
      pending: orderMap["pending"] ?? 0,
      ambiguous: orderMap["ambiguous"] ?? 0,
      failed: orderMap["failed"] ?? 0,
    },
    abuseProtection: {
      activeBlocks: abuse.activeBlocks,
      totalStrikes: abuse.totalStrikes,
    },
  };
}

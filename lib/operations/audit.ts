import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";
import { AuditEventInput, AuditEventRecord, AuditQueryFilter } from "./types";
import { desc, eq, and, gte } from "drizzle-orm";
import { logger } from "@/lib/shared/logger";

/**
 * Records an immutable audit event for security, compliance, and observability.
 */
export async function recordAuditEvent(event: AuditEventInput): Promise<AuditEventRecord> {
  try {
    const [created] = await db
      .insert(auditEvents)
      .values({
        userId: event.userId ?? null,
        action: event.action,
        targetId: event.targetId ?? null,
        targetType: event.targetType ?? null,
        ipAddress: event.ipAddress ?? null,
        metadata: event.metadata ?? {},
      })
      .returning();

    logger.info("Audit Event Recorded", {
      auditId: created.id,
      action: created.action,
      userId: created.userId,
      targetType: created.targetType,
      targetId: created.targetId,
    });

    return {
      id: created.id,
      userId: created.userId,
      action: created.action,
      targetId: created.targetId,
      targetType: created.targetType,
      ipAddress: created.ipAddress,
      metadata: created.metadata,
      createdAt: created.createdAt,
    };
  } catch (err) {
    logger.warn("Failed to record audit event non-blocking", { err, action: event.action });
    return {
      id: "fallback-audit-id",
      userId: event.userId ?? null,
      action: event.action,
      targetId: event.targetId ?? null,
      targetType: event.targetType ?? null,
      ipAddress: event.ipAddress ?? null,
      metadata: event.metadata ?? {},
      createdAt: new Date(),
    };
  }
}

/**
 * Queries audit event history with optional filtering.
 */
export async function queryAuditEvents(
  filter: AuditQueryFilter = {}
): Promise<AuditEventRecord[]> {
  const conditions = [];

  if (filter.userId) {
    conditions.push(eq(auditEvents.userId, filter.userId));
  }
  if (filter.action) {
    conditions.push(eq(auditEvents.action, filter.action));
  }
  if (filter.targetType) {
    conditions.push(eq(auditEvents.targetType, filter.targetType));
  }
  if (filter.targetId) {
    conditions.push(eq(auditEvents.targetId, filter.targetId));
  }
  if (filter.since) {
    conditions.push(gte(auditEvents.createdAt, filter.since));
  }

  const baseQuery = db.select().from(auditEvents);
  const withWhere = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
  const results = await withWhere
    .orderBy(desc(auditEvents.createdAt))
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);

  return results.map((r) => ({
    id: r.id,
    userId: r.userId,
    action: r.action,
    targetId: r.targetId,
    targetType: r.targetType,
    ipAddress: r.ipAddress,
    metadata: r.metadata,
    createdAt: r.createdAt,
  }));
}

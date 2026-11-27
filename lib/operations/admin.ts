import { db } from "@/lib/db";
import {
  evaluations,
  plans,
  paymentOrders,
} from "@/lib/db/schema";
import { eq, desc, and, lt } from "drizzle-orm";
import { ForbiddenError, NotFoundError, BadRequestError } from "@/lib/shared/errors";
import { resolveAmbiguousPaymentOrder } from "@/lib/payments/service";
import { recordAuditEvent } from "./audit";
import { FailedJobItem, PlanUpdateInput } from "./types";
import { logger } from "@/lib/shared/logger";

/**
 * Checks whether the user has administrator privileges.
 */
export function assertAdmin(user: { id: string; role?: string; email?: string }): void {
  const superAdminEmail = "israelashenafi29@gmail.com";
  if (user.email && user.email.toLowerCase().trim() === superAdminEmail) {
    return;
  }
  const adminIds = (process.env.ADMIN_USER_IDS ?? "admin,user-admin").split(",").map((s) => s.trim());
  const adminEmails = (process.env.ADMIN_EMAILS ?? "admin@cookmycv.com").split(",").map((s) => s.trim());

  const hasAdminRole = user.role === "admin";
  const hasAdminId = adminIds.includes(user.id);
  const hasAdminEmail = user.email ? adminEmails.includes(user.email.toLowerCase().trim()) : false;

  if (!hasAdminRole && !hasAdminId && !hasAdminEmail) {
    throw new ForbiddenError("Administrator access required for this action");
  }
}

// ==============================================================================
// 1. Payment Review Admin Tools
// ==============================================================================

export async function adminListAmbiguousPayments(adminUserId: string) {
  assertAdmin({ id: adminUserId });

  const ambiguousOrders = await db
    .select({
      id: paymentOrders.id,
      userId: paymentOrders.userId,
      planId: paymentOrders.planId,
      amountEtb: paymentOrders.amountEtb,
      currency: paymentOrders.currency,
      orderReference: paymentOrders.orderReference,
      expectedReceiver: paymentOrders.expectedReceiver,
      status: paymentOrders.status,
      expiresAt: paymentOrders.expiresAt,
      createdAt: paymentOrders.createdAt,
      updatedAt: paymentOrders.updatedAt,
    })
    .from(paymentOrders)
    .where(eq(paymentOrders.status, "ambiguous"))
    .orderBy(desc(paymentOrders.updatedAt));

  return ambiguousOrders;
}

export async function adminResolvePayment(
  orderId: string,
  adminUserId: string,
  action: "approve" | "reject",
  notes?: string
) {
  assertAdmin({ id: adminUserId });

  const resolved = await resolveAmbiguousPaymentOrder(orderId, adminUserId, action, notes);

  await recordAuditEvent({
    userId: adminUserId,
    action: "admin.payment_reviewed",
    targetType: "payment_order",
    targetId: orderId,
    metadata: { action, notes, orderReference: resolved.orderReference },
  });

  logger.info("Admin resolved ambiguous payment order", {
    orderId,
    adminUserId,
    action,
    notes,
  });

  return resolved;
}

// ==============================================================================
// 2. Plan Configuration Admin Tools
// ==============================================================================

export async function adminListPlans(adminUserId: string) {
  assertAdmin({ id: adminUserId });

  return await db.select().from(plans).orderBy(plans.priceEtb);
}

export async function adminUpdatePlan(
  planId: string,
  adminUserId: string,
  updates: PlanUpdateInput
) {
  assertAdmin({ id: adminUserId });

  if (updates.priceEtb !== undefined && updates.priceEtb < 0) {
    throw new BadRequestError("Price cannot be negative");
  }
  if (updates.dailyLimit !== undefined && updates.dailyLimit < 0) {
    throw new BadRequestError("Daily limit cannot be negative");
  }
  if (updates.monthlyLimit !== undefined && updates.monthlyLimit < 0) {
    throw new BadRequestError("Monthly limit cannot be negative");
  }

  const [existing] = await db
    .select()
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1);

  if (!existing) {
    throw new NotFoundError(`Plan with ID "${planId}" not found`);
  }

  const [updated] = await db
    .update(plans)
    .set({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.priceEtb !== undefined && { priceEtb: updates.priceEtb }),
      ...(updates.billingPeriodDays !== undefined && { billingPeriodDays: updates.billingPeriodDays }),
      ...(updates.dailyLimit !== undefined && { dailyLimit: updates.dailyLimit }),
      ...(updates.monthlyLimit !== undefined && { monthlyLimit: updates.monthlyLimit }),
      ...(updates.trialAllowance !== undefined && { trialAllowance: updates.trialAllowance }),
      ...(updates.active !== undefined && { active: updates.active }),
    })
    .where(eq(plans.id, planId))
    .returning();

  await recordAuditEvent({
    userId: adminUserId,
    action: "admin.plan_updated",
    targetType: "plan",
    targetId: planId,
    metadata: { previous: existing, updated },
  });

  logger.info("Admin updated plan configuration", {
    planId,
    adminUserId,
    updates,
  });

  return updated;
}

// ==============================================================================
// 3. Failed Jobs & Queue Admin Tools
// ==============================================================================

export async function adminListFailedJobs(
  adminUserId: string,
  limit = 50
): Promise<FailedJobItem[]> {
  assertAdmin({ id: adminUserId });

  const failed = await db
    .select({
      id: evaluations.id,
      ownerUserId: evaluations.ownerUserId,
      tone: evaluations.tone,
      status: evaluations.status,
      errorMessage: evaluations.errorMessage,
      createdAt: evaluations.createdAt,
      updatedAt: evaluations.updatedAt,
    })
    .from(evaluations)
    .where(eq(evaluations.status, "failed"))
    .orderBy(desc(evaluations.updatedAt))
    .limit(limit);

  return failed;
}

export async function adminRetryJob(
  evaluationId: string,
  adminUserId: string
): Promise<{ success: boolean; evaluationId: string; status: string }> {
  assertAdmin({ id: adminUserId });

  const [evalRecord] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (!evalRecord) {
    throw new NotFoundError("Evaluation job not found");
  }

  if (evalRecord.status !== "failed") {
    throw new BadRequestError(`Cannot retry evaluation with status "${evalRecord.status}"`);
  }

  const previousError = evalRecord.errorMessage;

  await db
    .update(evaluations)
    .set({
      status: "queued",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(evaluations.id, evaluationId));

  await recordAuditEvent({
    userId: adminUserId,
    action: "admin.job_retried",
    targetType: "evaluation",
    targetId: evaluationId,
    metadata: { previousError, newStatus: "queued" },
  });

  logger.info("Admin requeued failed evaluation job", {
    evaluationId,
    adminUserId,
  });

  return { success: true, evaluationId, status: "queued" };
}

export async function adminCancelStaleJobs(
  adminUserId: string,
  thresholdMinutes = 30
): Promise<{ cancelledCount: number; cancelledIds: string[] }> {
  assertAdmin({ id: adminUserId });

  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

  const staleRecords = await db
    .select({ id: evaluations.id })
    .from(evaluations)
    .where(
      and(
        eq(evaluations.status, "processing"),
        lt(evaluations.updatedAt, cutoff)
      )
    );

  const cancelledIds: string[] = [];

  for (const record of staleRecords) {
    await db
      .update(evaluations)
      .set({
        status: "failed",
        errorMessage: `Job timed out after ${thresholdMinutes} minutes of inactivity`,
        updatedAt: new Date(),
      })
      .where(eq(evaluations.id, record.id));

    cancelledIds.push(record.id);
  }

  if (cancelledIds.length > 0) {
    await recordAuditEvent({
      userId: adminUserId,
      action: "admin.stale_jobs_cleaned",
      targetType: "evaluation",
      metadata: { count: cancelledIds.length, cancelledIds, thresholdMinutes },
    });
  }

  return {
    cancelledCount: cancelledIds.length,
    cancelledIds,
  };
}

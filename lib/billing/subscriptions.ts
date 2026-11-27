import { db, subscriptions, users, getSqlClient } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getPlanByTier } from "./plans";
import type { PlanTier, SubscriptionRecord } from "./types";
import { logger } from "@/lib/shared/logger";

export interface UpgradeSubscriptionParams {
  userId: string;
  planTier: PlanTier;
  periodStart?: Date;
  periodEnd?: Date;
  renewalDate?: Date;
}

let billingTablesEnsured = false;

export async function ensureBillingTables(): Promise<void> {
  if (billingTablesEnsured) return;
  try {
    const sql = getSqlClient();
    await sql`
      CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" text NOT NULL,
        "plan_id" text NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
        "current_period_end" timestamp with time zone NOT NULL,
        "renewal_date" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `;
    await sql`
      ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "renewal_date" timestamp with time zone;
    `.catch(() => {});
    await sql`
      CREATE INDEX IF NOT EXISTS "subscriptions_user_id_idx" ON "subscriptions" ("user_id");
    `.catch(() => {});
    billingTablesEnsured = true;
  } catch (err) {
    logger.warn("Could not ensure billing tables in database", { err });
  }
}

/**
 * Idempotently upgrades or extends a user's subscription tier and quota allowances in Neon PostgreSQL.
 */
export async function upgradeUserSubscriptionTier(
  params: UpgradeSubscriptionParams
): Promise<SubscriptionRecord> {
  await ensureBillingTables();
  const plan = await getPlanByTier(params.planTier);
  const now = new Date();
  const durationDays = plan.billingPeriodDays || (params.planTier.includes("yearly") ? 365 : 30);

  const start = params.periodStart ?? now;
  const end =
    params.periodEnd ??
    new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const renewal = params.renewalDate ?? end;

  let targetUserId = params.userId;
  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!UUID_REGEX.test(targetUserId)) {
    try {
      const [userByEmail] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, targetUserId.toLowerCase().trim()))
        .limit(1);

      if (userByEmail?.id) {
        targetUserId = userByEmail.id;
      }
    } catch {
      // Non-blocking fallback
    }
  }

  // Guarantee user record exists in public.users to satisfy foreign key constraint
  try {
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!existingUser) {
      await db
        .insert(users)
        .values({
          id: targetUserId,
          email: `${targetUserId}@cookmycv.local`,
          name: "User",
        })
        .onConflictDoNothing();
    }
  } catch (_e) {
    // Non-blocking fallback
  }

  // Check existing subscription
  let existing: SubscriptionRecord | undefined;
  try {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, targetUserId))
      .limit(1);
    existing = row as SubscriptionRecord | undefined;
  } catch (_drizzleErr) {
    try {
      const sql = getSqlClient();
      const rows = await sql`
        SELECT id, user_id, plan_id, status, current_period_start, current_period_end, renewal_date, created_at, updated_at
        FROM subscriptions
        WHERE user_id = ${targetUserId}
        LIMIT 1
      `;
      if (rows && rows.length > 0) {
        const r = rows[0];
        existing = {
          id: String(r.id),
          userId: String(r.user_id),
          planId: String(r.plan_id),
          status: String(r.status) as SubscriptionRecord["status"],
          currentPeriodStart: new Date(r.current_period_start),
          currentPeriodEnd: new Date(r.current_period_end),
          renewalDate: r.renewal_date ? new Date(r.renewal_date) : null,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
        };
      }
    } catch (sqlErr) {
      logger.error("Raw SQL lookup also failed", { sqlErr });
    }
  }

  if (existing) {
    // Idempotency check: if already active with same plan and currentPeriodEnd covers this period, return as-is
    if (
      existing.status === "active" &&
      existing.planId === plan.id &&
      existing.currentPeriodEnd >= end
    ) {
      logger.info("Subscription already active for plan; idempotent no-op", {
        userId: targetUserId,
        planTier: params.planTier,
        subscriptionId: existing.id,
      });
      return existing as SubscriptionRecord;
    }

    try {
      const [updated] = await db
        .update(subscriptions)
        .set({
          planId: plan.id,
          status: "active",
          currentPeriodStart: start,
          currentPeriodEnd: end,
          renewalDate: renewal,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, existing.id))
        .returning();

      logger.info("Upgraded existing user subscription tier", {
        userId: targetUserId,
        planTier: params.planTier,
        planId: plan.id,
        currentPeriodStart: start.toISOString(),
        currentPeriodEnd: end.toISOString(),
      });

      return updated as SubscriptionRecord;
    } catch (_updateErr) {
      const sql = getSqlClient();
      const [upd] = await sql`
        UPDATE subscriptions
        SET plan_id = ${plan.id}, status = 'active', current_period_start = ${start.toISOString()}, current_period_end = ${end.toISOString()}, renewal_date = ${renewal.toISOString()}, updated_at = ${now.toISOString()}
        WHERE id = ${existing.id}
        RETURNING id, user_id, plan_id, status, current_period_start, current_period_end, renewal_date, created_at, updated_at
      `;
      return {
        id: String(upd.id),
        userId: String(upd.user_id),
        planId: String(upd.plan_id),
        status: String(upd.status) as SubscriptionRecord["status"],
        currentPeriodStart: new Date(upd.current_period_start),
        currentPeriodEnd: new Date(upd.current_period_end),
        renewalDate: upd.renewal_date ? new Date(upd.renewal_date) : null,
        createdAt: new Date(upd.created_at),
        updatedAt: new Date(upd.updated_at),
      };
    }
  }

  try {
    const [created] = await db
      .insert(subscriptions)
      .values({
        userId: targetUserId,
        planId: plan.id,
        status: "active",
        currentPeriodStart: start,
        currentPeriodEnd: end,
        renewalDate: renewal,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info("Created new user subscription tier", {
      userId: targetUserId,
      planTier: params.planTier,
      planId: plan.id,
      currentPeriodStart: start.toISOString(),
      currentPeriodEnd: end.toISOString(),
    });

    return created as SubscriptionRecord;
  } catch (_insertErr) {
    const sql = getSqlClient();
    const [ins] = await sql`
      INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_start, current_period_end, renewal_date, created_at, updated_at)
      VALUES (gen_random_uuid(), ${targetUserId}, ${plan.id}, 'active', ${start.toISOString()}, ${end.toISOString()}, ${renewal.toISOString()}, ${now.toISOString()}, ${now.toISOString()})
      RETURNING id, user_id, plan_id, status, current_period_start, current_period_end, renewal_date, created_at, updated_at
    `;
    return {
      id: String(ins.id),
      userId: String(ins.user_id),
      planId: String(ins.plan_id),
      status: String(ins.status) as SubscriptionRecord["status"],
      currentPeriodStart: new Date(ins.current_period_start),
      currentPeriodEnd: new Date(ins.current_period_end),
      renewalDate: ins.renewal_date ? new Date(ins.renewal_date) : null,
      createdAt: new Date(ins.created_at),
      updatedAt: new Date(ins.updated_at),
    };
  }
}

/**
 * Reverts a user's subscription to the free tier by marking the active subscription as cancelled.
 */
export async function revertUserToFreeTier(userId: string): Promise<void> {
  await ensureBillingTables();
  const now = new Date();
  let targetUserId = userId;
  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!UUID_REGEX.test(targetUserId)) {
    try {
      const [userByEmail] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, targetUserId.toLowerCase().trim()))
        .limit(1);

      if (userByEmail?.id) {
        targetUserId = userByEmail.id;
      }
    } catch {
      // Non-blocking fallback
    }
  }

  try {
    await db
      .update(subscriptions)
      .set({
        status: "cancelled",
        updatedAt: now,
      })
      .where(eq(subscriptions.userId, targetUserId));
  } catch (_e) {
    const sql = getSqlClient();
    await sql`
      UPDATE subscriptions
      SET status = 'cancelled', updated_at = ${now.toISOString()}
      WHERE user_id = ${targetUserId}
    `.catch(() => {});
  }

  logger.info("Reverted user subscription to free tier", {
    userId: targetUserId,
    timestamp: now.toISOString(),
  });
}

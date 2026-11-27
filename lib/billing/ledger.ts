import { db, usageCounters, usageLedger, subscriptions } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";
import { getAddisAbabaDateString } from "./timezone";
import { getPlanByTier, getPlanById } from "./plans";
import type { PlanRecord, CreditReservation } from "./types";
import { QuotaExceededError, ForbiddenError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import { randomUUID } from "node:crypto";
import {
  checkDeviceTrialEligibility,
  recordDeviceTrialClaim,
} from "@/lib/devices/trial-eligibility";
import { getReferralBonusCredits } from "@/lib/referrals/service";

export interface ReserveCreditParams {
  userId: string;
  evaluationId?: string;
  deviceId?: string;
  rawToken?: string | null;
  ipAddress?: string | null;
  headers?: Headers;
}

export interface ActiveSubscriptionInfo {
  subscription: typeof subscriptions.$inferSelect;
  plan: PlanRecord;
  monthlyPeriodKey: string;
}

/**
 * Resolves the user's active subscription and database-backed plan configuration.
 */
export async function getActiveUserSubscription(
  userId: string
): Promise<ActiveSubscriptionInfo | null> {
  const now = new Date();
  const [activeSub] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "active"),
        gt(subscriptions.currentPeriodEnd, now)
      )
    );

  if (!activeSub) return null;

  const plan = await getPlanById(activeSub.planId);
  if (!plan || !plan.active) return null;

  // Each 30-day window within the annual or monthly subscription gets its own monthlyPeriodKey
  const elapsedMs = Math.max(0, now.getTime() - activeSub.currentPeriodStart.getTime());
  const monthIndex = Math.floor(elapsedMs / (30 * 24 * 60 * 60 * 1000));
  const monthlyPeriodKey = `sub:${activeSub.id}:m${monthIndex}`;

  return {
    subscription: activeSub,
    plan,
    monthlyPeriodKey,
  };
}

/**
 * Atomically reserves 1 evaluation credit.
 * Enforces device-aware trial eligibility, lifetime trial allowance,
 * daily limits (Africa/Addis_Ababa midnight boundaries), and monthly limits.
 */
export async function reserveEvaluationCredit(
  params: ReserveCreditParams
): Promise<CreditReservation> {
  const activeSubInfo = await getActiveUserSubscription(params.userId);
  const isPaid = activeSubInfo !== null;
  const plan = isPaid ? activeSubInfo.plan : await getPlanByTier("free_trial");

  const todayDateStr = getAddisAbabaDateString();
  const dailyPeriodKey = `daily:${params.userId}:${todayDateStr}`;

  if (!isPaid) {
    // --------------------------------------------------------------------------
    // 1. DEVICE-AWARE FREE TRIAL ENFORCEMENT
    // --------------------------------------------------------------------------
    const eligibility = await checkDeviceTrialEligibility({
      userId: params.userId,
      deviceId: params.deviceId,
      rawToken: params.rawToken,
      ipAddress: params.ipAddress,
      headers: params.headers,
    });

    if (!eligibility.eligible) {
      if (eligibility.code === "DEVICE_TRIAL_ALREADY_CLAIMED") {
        throw new ForbiddenError(
          eligibility.reason ||
            "This device has already claimed a free trial under another account. Each device can only claim one free trial."
        );
      }
      if (
        eligibility.code === "DEVICE_NOT_REGISTERED" ||
        eligibility.code === "DEVICE_NOT_OWNED" ||
        eligibility.code === "DEVICE_REVOKED"
      ) {
        throw new ForbiddenError(
          eligibility.reason ||
            "An active registered device owned by your account is required to use the free trial."
        );
      }
      throw new QuotaExceededError(
        eligibility.reason ||
          `Free trial limit reached (${plan.trialAllowance} lifetime evaluations). Upgrade to Pro to continue.`
      );
    }

    // Atomically claim the device for free trial if not yet recorded
    if (!eligibility.deviceTrialClaimed && eligibility.device) {
      try {
        await recordDeviceTrialClaim({
          deviceId: eligibility.device.deviceId,
          userId: params.userId,
          ipAddress: params.ipAddress,
          riskScore: eligibility.riskScore,
          riskOutcome: eligibility.riskOutcome,
          metadata: {
            riskReason: eligibility.riskReason,
          },
        });
      } catch (claimErr) {
        // Handle potential concurrency collision on deviceTrialClaims
        logger.warn("Trial claim record collision or already claimed", {
          deviceId: eligibility.device.deviceId,
          userId: params.userId,
          error: claimErr instanceof Error ? claimErr.message : String(claimErr),
        });
      }
    }

    const trialPeriodKey = `trial:${params.userId}`;

    const [trialCounter] = await db
      .select()
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.userId, params.userId),
          eq(usageCounters.periodKey, trialPeriodKey)
        )
      );

    const used = trialCounter?.evaluationsUsed ?? 0;
    const reserved = trialCounter?.evaluationsReserved ?? 0;
    const bonusCredits = await getReferralBonusCredits(params.userId);
    const effectiveTrialAllowance = plan.trialAllowance + bonusCredits;

    if (used + reserved >= effectiveTrialAllowance) {
      throw new QuotaExceededError(
        `Free trial limit reached (${effectiveTrialAllowance} lifetime evaluations). Invite friends to get +1 free review per invite, or upgrade to Pro to continue.`
      );
    }

    // Atomically increment reserved count
    if (!trialCounter) {
      await db.insert(usageCounters).values({
        userId: params.userId,
        periodKey: trialPeriodKey,
        evaluationsUsed: 0,
        evaluationsReserved: 1,
      });
    } else {
      await db
        .update(usageCounters)
        .set({
          evaluationsReserved: trialCounter.evaluationsReserved + 1,
          updatedAt: new Date(),
        })
        .where(eq(usageCounters.id, trialCounter.id));
    }

    const reservationId = randomUUID();
    await db.insert(usageLedger).values({
      userId: params.userId,
      evaluationId: params.evaluationId,
      eventType: "reserved",
      credits: 1,
      reason: "free_trial_evaluation_started",
    });

    logger.info("Reserved trial credit", {
      userId: params.userId,
      reservationId,
      deviceId: eligibility.device?.deviceId,
    });

    return {
      reservationId,
      userId: params.userId,
      evaluationId: params.evaluationId,
      dailyPeriodKey: trialPeriodKey,
      monthlyPeriodKey: trialPeriodKey,
      credits: 1,
      reservedAt: new Date(),
    };
  }

  // ----------------------------------------------------------------------------
  // 2. PAID PLAN ENFORCEMENT (Daily 5/day & Monthly 150/mo)
  // ----------------------------------------------------------------------------
  const monthlyPeriodKey = activeSubInfo.monthlyPeriodKey;

  // Check Daily Quota (Africa/Addis_Ababa)
  const [dailyCounter] = await db
    .select()
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.userId, params.userId),
        eq(usageCounters.periodKey, dailyPeriodKey)
      )
    );

  const dailyUsed = dailyCounter?.evaluationsUsed ?? 0;
  const dailyReserved = dailyCounter?.evaluationsReserved ?? 0;

  if (dailyUsed + dailyReserved >= plan.dailyLimit) {
    throw new QuotaExceededError(
      `Daily evaluation limit reached (${plan.dailyLimit} per day in Africa/Addis_Ababa timezone). Resets at midnight.`
    );
  }

  // Check Monthly Quota (Current billing window)
  const [monthlyCounter] = await db
    .select()
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.userId, params.userId),
        eq(usageCounters.periodKey, monthlyPeriodKey)
      )
    );

  const monthlyUsed = monthlyCounter?.evaluationsUsed ?? 0;
  const monthlyReserved = monthlyCounter?.evaluationsReserved ?? 0;

  if (monthlyUsed + monthlyReserved >= plan.monthlyLimit) {
    throw new QuotaExceededError(
      `Monthly evaluation limit reached (${plan.monthlyLimit} evaluations). Resets on next billing month.`
    );
  }

  // Atomically update daily counter
  if (!dailyCounter) {
    await db.insert(usageCounters).values({
      userId: params.userId,
      periodKey: dailyPeriodKey,
      evaluationsUsed: 0,
      evaluationsReserved: 1,
    });
  } else {
    await db
      .update(usageCounters)
      .set({
        evaluationsReserved: dailyCounter.evaluationsReserved + 1,
        updatedAt: new Date(),
      })
      .where(eq(usageCounters.id, dailyCounter.id));
  }

  // Atomically update monthly counter
  if (!monthlyCounter) {
    await db.insert(usageCounters).values({
      userId: params.userId,
      periodKey: monthlyPeriodKey,
      evaluationsUsed: 0,
      evaluationsReserved: 1,
    });
  } else {
    await db
      .update(usageCounters)
      .set({
        evaluationsReserved: monthlyCounter.evaluationsReserved + 1,
        updatedAt: new Date(),
      })
      .where(eq(usageCounters.id, monthlyCounter.id));
  }

  const reservationId = randomUUID();
  await db.insert(usageLedger).values({
    userId: params.userId,
    evaluationId: params.evaluationId,
    eventType: "reserved",
    credits: 1,
    reason: `${plan.tier}_evaluation_started`,
  });

  logger.info("Reserved paid evaluation credit", {
    userId: params.userId,
    plan: plan.tier,
    reservationId,
  });

  return {
    reservationId,
    userId: params.userId,
    evaluationId: params.evaluationId,
    dailyPeriodKey,
    monthlyPeriodKey,
    credits: 1,
    reservedAt: new Date(),
  };
}

/**
 * Settles a reserved credit upon successful evaluation completion.
 * Decrements evaluationsReserved and increments evaluationsUsed.
 */
export async function settleEvaluationCredit(params: {
  userId: string;
  reservation: CreditReservation;
  evaluationId?: string;
}): Promise<void> {
  const periodKeys = [
    params.reservation.dailyPeriodKey,
    params.reservation.monthlyPeriodKey,
  ].filter((k): k is string => Boolean(k));

  // Deduplicate keys (for free trial both are the same key)
  const uniqueKeys = Array.from(new Set(periodKeys));

  for (const key of uniqueKeys) {
    const [counter] = await db
      .select()
      .from(usageCounters)
      .where(
        and(eq(usageCounters.userId, params.userId), eq(usageCounters.periodKey, key))
      );

    if (counter) {
      await db
        .update(usageCounters)
        .set({
          evaluationsReserved: Math.max(0, counter.evaluationsReserved - 1),
          evaluationsUsed: counter.evaluationsUsed + 1,
          updatedAt: new Date(),
        })
        .where(eq(usageCounters.id, counter.id));
    }
  }

  await db.insert(usageLedger).values({
    userId: params.userId,
    evaluationId: params.evaluationId || params.reservation.evaluationId,
    eventType: "settled",
    credits: 1,
    reason: "evaluation_completed_successfully",
  });

  logger.info("Settled evaluation credit", {
    userId: params.userId,
    reservationId: params.reservation.reservationId,
  });
}

/**
 * Releases a reserved credit on system/provider failure so users are not penalized.
 */
export async function releaseEvaluationCredit(params: {
  userId: string;
  reservation: CreditReservation;
  reason?: string;
}): Promise<void> {
  const periodKeys = [
    params.reservation.dailyPeriodKey,
    params.reservation.monthlyPeriodKey,
  ].filter((k): k is string => Boolean(k));

  const uniqueKeys = Array.from(new Set(periodKeys));

  for (const key of uniqueKeys) {
    const [counter] = await db
      .select()
      .from(usageCounters)
      .where(
        and(eq(usageCounters.userId, params.userId), eq(usageCounters.periodKey, key))
      );

    if (counter) {
      await db
        .update(usageCounters)
        .set({
          evaluationsReserved: Math.max(0, counter.evaluationsReserved - 1),
          updatedAt: new Date(),
        })
        .where(eq(usageCounters.id, counter.id));
    }
  }

  await db.insert(usageLedger).values({
    userId: params.userId,
    evaluationId: params.reservation.evaluationId,
    eventType: "released",
    credits: 1,
    reason: params.reason || "system_failure_refund",
  });

  logger.info("Released evaluation credit on system failure", {
    userId: params.userId,
    reservationId: params.reservation.reservationId,
    reason: params.reason,
  });
}

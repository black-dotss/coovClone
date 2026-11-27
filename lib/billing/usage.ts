import { db, usageCounters } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import {
  getAddisAbabaDateString,
  getAddisAbabaNextMidnight,
  ETHIOPIA_TIMEZONE,
} from "./timezone";
import { getActiveUserSubscription } from "./ledger";
import { getPlanByTier } from "./plans";
import type { UsageSummary } from "./types";
import { checkDeviceTrialEligibility } from "@/lib/devices/trial-eligibility";
import { getReferralBonusCredits } from "@/lib/referrals/service";

export interface GetUserUsageSummaryOptions {
  deviceId?: string;
  rawToken?: string | null;
  ipAddress?: string | null;
  headers?: Headers;
}

/**
 * Compiles a full usage and quota summary for the specified user.
 * Provides exact remaining daily and monthly allowances and reset timestamps.
 * Strictly uses Africa/Addis_Ababa timezone boundaries and enforces device-aware trial eligibility.
 */
export async function getUserUsageSummary(
  userId: string,
  options?: GetUserUsageSummaryOptions
): Promise<UsageSummary> {
  const activeSubInfo = await getActiveUserSubscription(userId);
  const isPaid = activeSubInfo !== null;
  const plan = isPaid ? activeSubInfo.plan : await getPlanByTier("free_trial");

  const todayDateStr = getAddisAbabaDateString();
  const dailyPeriodKey = `daily:${userId}:${todayDateStr}`;
  const nextDailyReset = getAddisAbabaNextMidnight().toISOString();

  // 1. Free Trial Status
  const trialPeriodKey = `trial:${userId}`;
  const [trialCounter] = await db
    .select()
    .from(usageCounters)
    .where(
      and(eq(usageCounters.userId, userId), eq(usageCounters.periodKey, trialPeriodKey))
    );

  const trialUsed = trialCounter?.evaluationsUsed ?? 0;
  const trialReserved = trialCounter?.evaluationsReserved ?? 0;
  const bonusCredits = await getReferralBonusCredits(userId);
  const effectiveTrialAllowance = plan.trialAllowance + bonusCredits;
  const trialRemaining = Math.max(0, effectiveTrialAllowance - (trialUsed + trialReserved));

  if (!isPaid) {
    // Check device-aware trial eligibility
    const eligibility = await checkDeviceTrialEligibility({
      userId,
      deviceId: options?.deviceId,
      rawToken: options?.rawToken,
      ipAddress: options?.ipAddress,
      headers: options?.headers,
    });

    const isEligible = eligibility.eligible && trialRemaining > 0;
    const canEvaluate = isEligible;

    return {
      plan: {
        id: plan.id,
        name: plan.name,
        tier: plan.tier,
        priceEtb: plan.priceEtb,
      },
      quotas: {
        timezone: ETHIOPIA_TIMEZONE,
        daily: {
          used: trialUsed,
          reserved: trialReserved,
          limit: effectiveTrialAllowance,
          remaining: trialRemaining,
          resetsAt: "never (lifetime)",
        },
        monthly: {
          used: trialUsed,
          reserved: trialReserved,
          limit: effectiveTrialAllowance,
          remaining: trialRemaining,
          resetsAt: "never (lifetime)",
        },
        trial: {
          isTrial: true,
          used: trialUsed + trialReserved,
          limit: effectiveTrialAllowance,
          remaining: trialRemaining,
          bonusCredits,
          eligible: eligibility.eligible,
          ineligibilityReason: eligibility.reason,
          deviceClaimed: eligibility.deviceTrialClaimed,
        },
        device: {
          deviceId: eligibility.device?.deviceId || null,
          isRegistered: Boolean(eligibility.device),
          trialClaimedOnDevice: Boolean(eligibility.deviceTrialClaimed),
          status: eligibility.device?.status || null,
          riskOutcome: eligibility.riskOutcome,
          riskReason: eligibility.riskReason || null,
        },
        canEvaluate,
      },
    };
  }

  // 2. Paid Subscription Status
  const [dailyCounter] = await db
    .select()
    .from(usageCounters)
    .where(
      and(eq(usageCounters.userId, userId), eq(usageCounters.periodKey, dailyPeriodKey))
    );

  const dailyUsed = dailyCounter?.evaluationsUsed ?? 0;
  const dailyReserved = dailyCounter?.evaluationsReserved ?? 0;
  const dailyRemaining = Math.max(0, plan.dailyLimit - (dailyUsed + dailyReserved));

  const [monthlyCounter] = await db
    .select()
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.userId, userId),
        eq(usageCounters.periodKey, activeSubInfo.monthlyPeriodKey)
      )
    );

  const monthlyUsed = monthlyCounter?.evaluationsUsed ?? 0;
  const monthlyReserved = monthlyCounter?.evaluationsReserved ?? 0;
  const monthlyRemaining = Math.max(0, plan.monthlyLimit - (monthlyUsed + monthlyReserved));

  // Next monthly reset is the current subscription end date
  const nextMonthlyReset = activeSubInfo.subscription.currentPeriodEnd.toISOString();
  const canEvaluate = dailyRemaining > 0 && monthlyRemaining > 0;

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      tier: plan.tier,
      priceEtb: plan.priceEtb,
    },
    subscription: {
      id: activeSubInfo.subscription.id,
      status: activeSubInfo.subscription.status as "active" | "cancelled" | "expired",
      currentPeriodStart: activeSubInfo.subscription.currentPeriodStart?.toISOString(),
      currentPeriodEnd: nextMonthlyReset,
      createdAt: activeSubInfo.subscription.createdAt?.toISOString(),
      renewalDate: activeSubInfo.subscription.renewalDate?.toISOString() ?? null,
    },
    quotas: {
      timezone: ETHIOPIA_TIMEZONE,
      daily: {
        used: dailyUsed,
        reserved: dailyReserved,
        limit: plan.dailyLimit,
        remaining: dailyRemaining,
        resetsAt: nextDailyReset,
      },
      monthly: {
        used: monthlyUsed,
        reserved: monthlyReserved,
        limit: plan.monthlyLimit,
        remaining: monthlyRemaining,
        resetsAt: nextMonthlyReset,
      },
      trial: {
        isTrial: false,
        used: trialUsed,
        limit: plan.trialAllowance,
        remaining: 0,
        eligible: false,
      },
      canEvaluate,
    },
  };
}

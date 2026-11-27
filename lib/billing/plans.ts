import { db, plans } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { PlanRecord, PlanTier } from "./types";
import { logger } from "@/lib/shared/logger";

export const DEFAULT_PLAN_CONFIGS: Record<PlanTier, Omit<PlanRecord, "createdAt" | "updatedAt">> = {
  free_trial: {
    id: "plan_free_trial",
    name: "Free Trial",
    tier: "free_trial",
    priceEtb: 0,
    billingPeriodDays: 0,
    dailyLimit: 3,
    monthlyLimit: 3,
    trialAllowance: 3,
    active: true,
  },
  pro_monthly: {
    id: "plan_pro_monthly",
    name: "Pro Monthly",
    tier: "pro_monthly",
    priceEtb: 150,
    billingPeriodDays: 30,
    dailyLimit: 5,
    monthlyLimit: 150,
    trialAllowance: 0,
    active: true,
  },
  pro_plus_monthly: {
    id: "plan_pro_plus_monthly",
    name: "Pro Plus Monthly",
    tier: "pro_plus_monthly",
    priceEtb: 300,
    billingPeriodDays: 30,
    dailyLimit: 12,
    monthlyLimit: 350,
    trialAllowance: 0,
    active: true,
  },
  pro_yearly: {
    id: "plan_pro_yearly",
    name: "Pro Yearly",
    tier: "pro_yearly",
    priceEtb: 1000,
    billingPeriodDays: 365,
    dailyLimit: 5,
    monthlyLimit: 150,
    trialAllowance: 0,
    active: true,
  },
  pro_plus_yearly: {
    id: "plan_pro_plus_yearly",
    name: "Pro Plus Yearly",
    tier: "pro_plus_yearly",
    priceEtb: 2000,
    billingPeriodDays: 365,
    dailyLimit: 12,
    monthlyLimit: 350,
    trialAllowance: 0,
    active: true,
  },
  unlimited_yearly: {
    id: "plan_unlimited_yearly",
    name: "Executive Unlimited Yearly",
    tier: "unlimited_yearly",
    priceEtb: 4000,
    billingPeriodDays: 365,
    dailyLimit: 9999,
    monthlyLimit: 99999,
    trialAllowance: 0,
    active: true,
  },
};

/**
 * Seeds default plans into the database if they do not exist.
 */
export async function seedDefaultPlans(): Promise<void> {
  for (const config of Object.values(DEFAULT_PLAN_CONFIGS)) {
    try {
      const [existing] = await db.select().from(plans).where(eq(plans.id, config.id));
      if (!existing) {
        await db.insert(plans).values({
          id: config.id,
          name: config.name,
          tier: config.tier,
          priceEtb: config.priceEtb,
          billingPeriodDays: config.billingPeriodDays,
          dailyLimit: config.dailyLimit,
          monthlyLimit: config.monthlyLimit,
          trialAllowance: config.trialAllowance,
          active: config.active,
        });
        logger.info(`Seeded default plan: ${config.name} (${config.id})`);
      }
    } catch (_err) {
      logger.warn("Database not ready for plan seeding", { planId: config.id });
    }
  }
}

/**
 * Retrieves a plan record from the database by its tier.
 * Always reads database-backed configuration so admin updates take effect without code edits.
 */
export async function getPlanByTier(tier: PlanTier): Promise<PlanRecord> {
  try {
    const [record] = await db.select().from(plans).where(eq(plans.tier, tier));
    if (record && "tier" in record && record.tier === tier) {
      return record as PlanRecord;
    }
  } catch (_err) {
    // Database unreachable or mocked in test environment
  }

  // Fallback to default in memory
  const fallback = DEFAULT_PLAN_CONFIGS[tier];
  return {
    ...fallback,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Retrieves a plan record from the database by ID.
 */
export async function getPlanById(planId: string): Promise<PlanRecord | null> {
  try {
    const [record] = await db.select().from(plans).where(eq(plans.id, planId));
    if (record && "id" in record && record.id === planId) {
      return record as PlanRecord;
    }
  } catch (_err) {
    // Database unreachable or mocked in test environment
  }

  const found = Object.values(DEFAULT_PLAN_CONFIGS).find((p) => p.id === planId);
  if (found) {
    return { ...found, createdAt: new Date(), updatedAt: new Date() };
  }
  return null;
}

/**
 * Admin operation: updates plan configuration (price, limits, active status)
 * directly in the database without code edits.
 */
export async function updatePlanConfig(
  planId: string,
  updates: Partial<Omit<PlanRecord, "id" | "createdAt" | "updatedAt">>
): Promise<PlanRecord> {
  const [updated] = await db
    .update(plans)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(plans.id, planId))
    .returning();

  logger.info(`Admin updated plan configuration: ${planId}`, { updates });
  return updated as PlanRecord;
}

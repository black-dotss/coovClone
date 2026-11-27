import { describe, it, expect, vi } from "vitest";
import { DEFAULT_PLAN_CONFIGS } from "@/lib/billing/plans";

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    insert: () => ({
      values: () => Promise.resolve(),
    }),
  },
  plans: {},
}));

import { getPlanByTier } from "@/lib/billing/plans";

describe("Plan Configurations and Entitlements", () => {
  it("defines free trial with 3 lifetime evaluations", () => {
    const trial = DEFAULT_PLAN_CONFIGS.free_trial;
    expect(trial.tier).toBe("free_trial");
    expect(trial.priceEtb).toBe(0);
    expect(trial.trialAllowance).toBe(3);
  });

  it("defines Pro Monthly with 150 ETB, 150/month, and 5/day limits", () => {
    const monthly = DEFAULT_PLAN_CONFIGS.pro_monthly;
    expect(monthly.tier).toBe("pro_monthly");
    expect(monthly.priceEtb).toBe(150);
    expect(monthly.billingPeriodDays).toBe(30);
    expect(monthly.dailyLimit).toBe(5);
    expect(monthly.monthlyLimit).toBe(150);
  });

  it("defines Pro Plus Monthly with 300 ETB, 350/month, and 12/day limits", () => {
    const monthly = DEFAULT_PLAN_CONFIGS.pro_plus_monthly;
    expect(monthly.tier).toBe("pro_plus_monthly");
    expect(monthly.priceEtb).toBe(300);
    expect(monthly.billingPeriodDays).toBe(30);
    expect(monthly.dailyLimit).toBe(12);
    expect(monthly.monthlyLimit).toBe(350);
  });

  it("defines Pro Yearly with 1,000 ETB, 150/month, and 5/day limits", () => {
    const yearly = DEFAULT_PLAN_CONFIGS.pro_yearly;
    expect(yearly.tier).toBe("pro_yearly");
    expect(yearly.priceEtb).toBe(1000);
    expect(yearly.billingPeriodDays).toBe(365);
    expect(yearly.dailyLimit).toBe(5);
    expect(yearly.monthlyLimit).toBe(150);
  });

  it("defines Pro Plus Yearly with 2,000 ETB and Executive Unlimited with 4,000 ETB", () => {
    const plusYearly = DEFAULT_PLAN_CONFIGS.pro_plus_yearly;
    expect(plusYearly.tier).toBe("pro_plus_yearly");
    expect(plusYearly.priceEtb).toBe(2000);
    expect(plusYearly.billingPeriodDays).toBe(365);

    const unlimited = DEFAULT_PLAN_CONFIGS.unlimited_yearly;
    expect(unlimited.tier).toBe("unlimited_yearly");
    expect(unlimited.priceEtb).toBe(4000);
    expect(unlimited.billingPeriodDays).toBe(365);
  });

  it("retrieves plan configuration by tier", async () => {
    const plan = await getPlanByTier("pro_monthly");
    expect(plan.priceEtb).toBe(150);
    expect(plan.dailyLimit).toBe(5);
    expect(plan.monthlyLimit).toBe(150);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { QuotaExceededError } from "@/lib/shared/errors";
import { DEFAULT_PLAN_CONFIGS } from "@/lib/billing/plans";

// In-memory mock database state hoisted for Vitest
const mocks = vi.hoisted(() => {
  interface MockCounter {
    id: string;
    userId: string;
    periodKey: string;
    evaluationsUsed: number;
    evaluationsReserved: number;
  }

  const mockCounters: MockCounter[] = [];
  const mockLedgerEntries: Record<string, unknown>[] = [];
  const mockSubscriptions: Record<string, unknown>[] = [];
  const mockPlans: Record<string, unknown>[] = [];

  const mockSubscriptionsTable = { name: "subscriptions" };
  const mockPlansTable = { name: "plans" };
  const mockUsageCountersTable = { name: "usage_counters" };
  const mockUsageLedgerTable = { name: "usage_ledger" };

  return {
    mockCounters,
    mockLedgerEntries,
    mockSubscriptions,
    mockPlans,
    mockSubscriptionsTable,
    mockPlansTable,
    mockUsageCountersTable,
    mockUsageLedgerTable,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          if (table === mocks.mockSubscriptionsTable) {
            return mocks.mockSubscriptions;
          }
          if (table === mocks.mockPlansTable) {
            return mocks.mockPlans;
          }
          // Filter mockCounters by periodKey if inspectable from condition
          const condStr = JSON.stringify(condition);
          const found = mocks.mockCounters.filter((c) => condStr.includes(c.periodKey));
          return found;
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (val: Record<string, unknown>) => {
        if (val.periodKey) {
          const newEntry = {
            id: `counter-${mocks.mockCounters.length + 1}`,
            userId: val.userId as string,
            periodKey: val.periodKey as string,
            evaluationsUsed: (val.evaluationsUsed as number) || 0,
            evaluationsReserved: (val.evaluationsReserved as number) || 0,
          };
          mocks.mockCounters.push(newEntry);
        } else if (val.eventType) {
          mocks.mockLedgerEntries.push(val);
        }
        return Promise.resolve([val]);
      },
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          for (const c of mocks.mockCounters) {
            if (updates.evaluationsReserved !== undefined) {
              c.evaluationsReserved = updates.evaluationsReserved as number;
            }
            if (updates.evaluationsUsed !== undefined) {
              c.evaluationsUsed = updates.evaluationsUsed as number;
            }
          }
          return Promise.resolve();
        },
      }),
    }),
  },
  usageCounters: mocks.mockUsageCountersTable,
  usageLedger: mocks.mockUsageLedgerTable,
  subscriptions: mocks.mockSubscriptionsTable,
  plans: mocks.mockPlansTable,
  referrals: { name: "referrals" },
  users: { name: "users" },
}));

vi.mock("@/lib/devices/trial-eligibility", () => ({
  checkDeviceTrialEligibility: vi.fn().mockImplementation(async (params: { userId: string }) => {
    const trialCounter = mocks.mockCounters.find(
      (c) => c.userId === params.userId && c.periodKey === `trial:${params.userId}`
    );
    const used = trialCounter?.evaluationsUsed ?? 0;
    const reserved = trialCounter?.evaluationsReserved ?? 0;
    if (used + reserved >= 3) {
      return {
        eligible: false,
        code: "TRIAL_LIMIT_EXCEEDED",
        reason: "Free trial limit reached (3 lifetime evaluations). Upgrade to Pro to continue.",
        riskScore: 0,
        riskOutcome: "allowed",
        device: { deviceId: `dev_${params.userId}`, status: "active" },
      };
    }
    return {
      eligible: true,
      riskScore: 0,
      riskOutcome: "allowed",
      device: { deviceId: `dev_${params.userId}`, status: "active" },
      deviceTrialClaimed: true,
    };
  }),
  recordDeviceTrialClaim: vi.fn().mockResolvedValue({ id: "claim-1" }),
}));

import {
  reserveEvaluationCredit,
  settleEvaluationCredit,
  releaseEvaluationCredit,
} from "@/lib/billing/ledger";
import { getAddisAbabaDateString } from "@/lib/billing/timezone";

describe("Usage Ledger & Credit Lifecycle Enforcement", () => {
  beforeEach(() => {
    mocks.mockCounters.length = 0;
    mocks.mockLedgerEntries.length = 0;
    mocks.mockSubscriptions.length = 0;
    mocks.mockPlans.length = 0;
    mocks.mockPlans.push(DEFAULT_PLAN_CONFIGS.free_trial);
  });

  describe("Free Trial Lifecycle (3 Lifetime Evaluations)", () => {
    it("allows reserving up to 3 evaluations for a free account", async () => {
      const userId = "free-user-1";

      const r1 = await reserveEvaluationCredit({ userId });
      expect(r1.credits).toBe(1);
      expect(mocks.mockCounters[0].evaluationsReserved).toBe(1);

      const r2 = await reserveEvaluationCredit({ userId });
      expect(r2.credits).toBe(1);

      const r3 = await reserveEvaluationCredit({ userId });
      expect(r3.credits).toBe(1);
    });

    it("rejects 4th evaluation with QuotaExceededError when 3 are already reserved or used", async () => {
      const userId = "free-user-2";
      mocks.mockCounters.push({
        id: "c-1",
        userId,
        periodKey: `trial:${userId}`,
        evaluationsUsed: 3,
        evaluationsReserved: 0,
      });

      await expect(reserveEvaluationCredit({ userId })).rejects.toThrowError(
        QuotaExceededError
      );
    });
  });

  describe("Credit Settlement and Release", () => {
    it("settles credit on completion by moving reserved to used", async () => {
      const userId = "user-settle";
      const reservation = await reserveEvaluationCredit({ userId });

      expect(mocks.mockCounters[0].evaluationsReserved).toBe(1);
      expect(mocks.mockCounters[0].evaluationsUsed).toBe(0);

      await settleEvaluationCredit({ userId, reservation });

      expect(mocks.mockCounters[0].evaluationsReserved).toBe(0);
      expect(mocks.mockCounters[0].evaluationsUsed).toBe(1);

      const settleLedger = mocks.mockLedgerEntries.find((e) => e.eventType === "settled");
      expect(settleLedger).toBeDefined();
    });

    it("releases credit on system failure restoring the user's quota", async () => {
      const userId = "user-release";
      const reservation = await reserveEvaluationCredit({ userId });

      expect(mocks.mockCounters[0].evaluationsReserved).toBe(1);

      await releaseEvaluationCredit({
        userId,
        reservation,
        reason: "ai_provider_outage",
      });

      expect(mocks.mockCounters[0].evaluationsReserved).toBe(0);
      expect(mocks.mockCounters[0].evaluationsUsed).toBe(0);

      const releaseLedger = mocks.mockLedgerEntries.find((e) => e.eventType === "released");
      expect(releaseLedger).toBeDefined();
      expect(releaseLedger?.reason).toBe("ai_provider_outage");
    });
  });

  describe("Paid Plan Quota Enforcement (Daily 5/day & Monthly 150/mo)", () => {
    it("enforces paid daily quota limit (5 per day)", async () => {
      const userId = "pro-user-daily";
      const activeSubscription = {
        id: "sub-123",
        userId,
        planId: "plan_pro_monthly",
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      mocks.mockSubscriptions.push(activeSubscription);
      mocks.mockPlans.length = 0;
      mocks.mockPlans.push(DEFAULT_PLAN_CONFIGS.pro_monthly);

      const todayStr = getAddisAbabaDateString();

      // Simulate 5 already used today
      mocks.mockCounters.push({
        id: "c-daily",
        userId,
        periodKey: `daily:${userId}:${todayStr}`,
        evaluationsUsed: 5,
        evaluationsReserved: 0,
      });

      await expect(reserveEvaluationCredit({ userId })).rejects.toThrowError(
        /Daily evaluation limit reached/
      );
    });

    it("enforces paid monthly quota limit (150 per month)", async () => {
      const userId = "pro-user-monthly";
      const activeSubscription = {
        id: "sub-456",
        userId,
        planId: "plan_pro_monthly",
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      mocks.mockSubscriptions.push(activeSubscription);
      mocks.mockPlans.length = 0;
      mocks.mockPlans.push(DEFAULT_PLAN_CONFIGS.pro_monthly);

      // Simulate 150 already used in this monthly billing window
      mocks.mockCounters.push({
        id: "c-monthly",
        userId,
        periodKey: "sub:sub-456:m0",
        evaluationsUsed: 150,
        evaluationsReserved: 0,
      });

      await expect(reserveEvaluationCredit({ userId })).rejects.toThrowError(
        /Monthly evaluation limit reached/
      );
    });
  });
});

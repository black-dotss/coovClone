import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  devices,
  deviceTrialClaims,
  deviceTombstones,
  deviceEvents,
  usageCounters,
  usageLedger,
  subscriptions,
  plans,
} from "@/lib/db/schema";
import {
  checkDeviceTrialEligibility,
  recordDeviceTrialClaim,
  getDeviceTrialClaim,
  getAccountTrialHistory,
} from "@/lib/devices/trial-eligibility";
import {
  reserveEvaluationCredit,
} from "@/lib/billing/ledger";
import {
  getUserUsageSummary,
} from "@/lib/billing/usage";
import {
  getAddisAbabaDateString,
  getAddisAbabaNextMidnight,
  getAddisAbabaMidnight,
  isSameAddisAbabaDay,
  ETHIOPIA_TIMEZONE,
} from "@/lib/billing/timezone";
import { generateDeviceToken } from "@/lib/devices/tokens";
import { ForbiddenError } from "@/lib/shared/errors";
import { DEFAULT_PLAN_CONFIGS } from "@/lib/billing/plans";

// In-memory data store for the test suite
interface MockDevice {
  id: string;
  ownerUserId: string;
  deviceId: string;
  tokenHash: string;
  fingerprintHash: string | null;
  label: string | null;
  status: "active" | "revoked";
  trialClaimedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface MockDeviceTrialClaim {
  id: string;
  deviceId: string;
  userId: string;
  claimedAt: Date;
  ipAddress: string | null;
  riskScore: number;
  riskOutcome: "allowed" | "flagged_for_review" | "blocked";
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

interface MockDeviceTombstone {
  id: string;
  deviceId: string;
  tokenHash: string;
  originalOwnerUserId: string | null;
  reason: string;
  trialConsumed: boolean;
  tombstonedAt: Date;
}

interface MockUsageCounter {
  id: string;
  userId: string;
  periodKey: string;
  evaluationsUsed: number;
  evaluationsReserved: number;
}

const inMemory = {
  devices: [] as MockDevice[],
  trialClaims: [] as MockDeviceTrialClaim[],
  tombstones: [] as MockDeviceTombstone[],
  counters: [] as MockUsageCounter[],
  ledger: [] as Record<string, unknown>[],
  subscriptions: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
};

// Safe string extractor from Drizzle query clauses (avoids circular JSON.stringify)
function findStringsInClause(clause: unknown, seen = new Set<unknown>()): string[] {
  if (!clause || typeof clause !== "object" || seen.has(clause)) return [];
  seen.add(clause);
  const found: string[] = [];
  const obj = clause as Record<string, unknown>;
  if (typeof obj.value === "string") {
    found.push(obj.value);
  }
  for (const [key, val] of Object.entries(obj)) {
    if (key === "table" || key === "schema") continue;
    if (typeof val === "string") {
      found.push(val);
    } else if (typeof val === "object" && val !== null) {
      found.push(...findStringsInClause(val, seen));
    }
  }
  return found;
}

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => createMockQuery(data.slice(0, n)),
    orderBy: () => createMockQuery(data),
    where: () => createMockQuery(data),
  });
}

// Mock the database layer cleanly
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    db: {
      select: (_fields?: unknown) => ({
        from: (table: unknown) => ({
          where: (clause: unknown) => {
            const strings = findStringsInClause(clause);

            if (table === devices) {
              const matched = inMemory.devices.filter((d) => {
                // If checking by tokenHash
                if (strings.includes(d.tokenHash)) return true;
                // If checking by deviceId
                if (strings.includes(d.deviceId)) return true;
                // If checking by ownerUserId
                if (strings.includes(d.ownerUserId)) {
                  if (strings.includes("active") && d.status !== "active") return false;
                  return true;
                }
                return false;
              });
              return createMockQuery(matched);
            }

            if (table === deviceTrialClaims) {
              const matched = inMemory.trialClaims.filter((c) => {
                if (strings.includes(c.deviceId)) return true;
                if (strings.includes(c.userId)) return true;
                if (c.ipAddress && strings.includes(c.ipAddress)) return true;
                return false;
              });
              return createMockQuery(matched);
            }

            if (table === deviceTombstones) {
              const matched = inMemory.tombstones.filter((t) => strings.includes(t.deviceId));
              return createMockQuery(matched);
            }

            if (table === usageCounters) {
              // Match by exact periodKey if present in strings
              const matched = inMemory.counters.filter((cnt) => {
                return strings.includes(cnt.periodKey);
              });
              return createMockQuery(matched);
            }

            if (table === subscriptions) {
              const matched = inMemory.subscriptions.filter((s) =>
                strings.includes(s.userId as string)
              );
              return createMockQuery(matched);
            }

            if (table === plans) {
              return createMockQuery([
                DEFAULT_PLAN_CONFIGS.free_trial,
                DEFAULT_PLAN_CONFIGS.pro_monthly,
                DEFAULT_PLAN_CONFIGS.pro_yearly,
              ]);
            }

            return createMockQuery([]);
          },
          orderBy: () => createMockQuery(inMemory.devices),
          limit: (n: number) => createMockQuery(inMemory.devices.slice(0, n)),
        }),
      }),

      insert: (table: unknown) => ({
        values: (val: Record<string, unknown>) => {
          if (table === deviceTrialClaims) {
            const entry: MockDeviceTrialClaim = {
              id: `claim-${inMemory.trialClaims.length + 1}`,
              deviceId: val.deviceId as string,
              userId: val.userId as string,
              claimedAt: (val.claimedAt as Date) || new Date(),
              ipAddress: (val.ipAddress as string) || null,
              riskScore: (val.riskScore as number) || 0,
              riskOutcome: (val.riskOutcome as "allowed" | "flagged_for_review" | "blocked") || "allowed",
              metadata: (val.metadata as Record<string, unknown>) || {},
              createdAt: new Date(),
            };
            inMemory.trialClaims.push(entry);
            const p = Promise.resolve([entry]);
            return Object.assign(p, {
              returning: () => Promise.resolve([entry]),
            });
          }

          if (table === devices) {
            const dev: MockDevice = {
              id: `dev-${inMemory.devices.length + 1}`,
              ownerUserId: val.ownerUserId as string,
              deviceId: val.deviceId as string,
              tokenHash: val.tokenHash as string,
              fingerprintHash: (val.fingerprintHash as string) || null,
              label: (val.label as string) || null,
              status: (val.status as "active" | "revoked") || "active",
              trialClaimedAt: (val.trialClaimedAt as Date) || null,
              firstSeenAt: new Date(),
              lastSeenAt: new Date(),
              revokedAt: null,
              createdAt: new Date(),
            };
            inMemory.devices.push(dev);
            const p = Promise.resolve([dev]);
            return Object.assign(p, {
              returning: () => Promise.resolve([dev]),
            });
          }

          if (table === usageCounters) {
            const counter: MockUsageCounter = {
              id: `cnt-${inMemory.counters.length + 1}`,
              userId: val.userId as string,
              periodKey: val.periodKey as string,
              evaluationsUsed: (val.evaluationsUsed as number) || 0,
              evaluationsReserved: (val.evaluationsReserved as number) || 0,
            };
            inMemory.counters.push(counter);
            return Object.assign(Promise.resolve([counter]), {
              returning: () => Promise.resolve([counter]),
            });
          }

          if (table === usageLedger) {
            inMemory.ledger.push(val);
            return Object.assign(Promise.resolve([val]), {
              returning: () => Promise.resolve([val]),
            });
          }

          if (table === deviceEvents) {
            inMemory.events.push(val);
            return Object.assign(Promise.resolve([val]), {
              returning: () => Promise.resolve([val]),
            });
          }

          const fallback = { id: `id-${Date.now()}`, ...val };
          return Object.assign(Promise.resolve([fallback]), {
            returning: () => Promise.resolve([fallback]),
          });
        },
      }),

      update: (table: unknown) => ({
        set: (updates: Record<string, unknown>) => ({
          where: (clause: unknown) => {
            const strings = findStringsInClause(clause);
            if (table === devices) {
              for (const dev of inMemory.devices) {
                if (strings.includes(dev.deviceId) || strings.includes(dev.id)) {
                  if (updates.status !== undefined) dev.status = updates.status as "active" | "revoked";
                  if (updates.trialClaimedAt !== undefined) dev.trialClaimedAt = updates.trialClaimedAt as Date;
                  if (updates.lastSeenAt !== undefined) dev.lastSeenAt = updates.lastSeenAt as Date;
                  if (updates.revokedAt !== undefined) dev.revokedAt = updates.revokedAt as Date;
                }
              }
            }
            if (table === usageCounters) {
              for (const c of inMemory.counters) {
                if (updates.evaluationsReserved !== undefined) {
                  c.evaluationsReserved = updates.evaluationsReserved as number;
                }
                if (updates.evaluationsUsed !== undefined) {
                  c.evaluationsUsed = updates.evaluationsUsed as number;
                }
              }
            }
            return Promise.resolve();
          },
        }),
      }),
    },
  };
});

describe("Task 12: Device-Aware Trial Eligibility and Usage APIs", () => {
  beforeEach(() => {
    inMemory.devices.length = 0;
    inMemory.trialClaims.length = 0;
    inMemory.tombstones.length = 0;
    inMemory.counters.length = 0;
    inMemory.ledger.length = 0;
    inMemory.subscriptions.length = 0;
    inMemory.events.length = 0;
  });

  // Helper to register a mock active device for a user
  function createTestDevice(userId: string, label = "Test Laptop") {
    const { deviceId, rawToken, tokenHash } = generateDeviceToken();
    const dev: MockDevice = {
      id: `dev-uuid-${inMemory.devices.length + 1}`,
      ownerUserId: userId,
      deviceId,
      tokenHash,
      fingerprintHash: "fp_hash_12345",
      label,
      status: "active",
      trialClaimedAt: null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
    };
    inMemory.devices.push(dev);
    return { deviceId, rawToken, tokenHash, dev };
  }

  describe("1. Active Device Ownership Checks", () => {
    it("allows trial eligibility when an active registered device is owned by the user", async () => {
      const userA = "user-alice";
      const { deviceId, rawToken } = createTestDevice(userA);

      const result = await checkDeviceTrialEligibility({
        userId: userA,
        deviceId,
        rawToken,
      });

      expect(result.eligible).toBe(true);
      expect(result.riskOutcome).toBe("allowed");
      expect(result.device?.deviceId).toBe(deviceId);
      expect(result.deviceTrialClaimed).toBe(false);
    });

    it("rejects trial when user has no active registered device", async () => {
      const userNoDevice = "user-no-device";

      const result = await checkDeviceTrialEligibility({
        userId: userNoDevice,
      });

      expect(result.eligible).toBe(false);
      expect(result.code).toBe("DEVICE_NOT_REGISTERED");
      expect(result.reason).toContain("registered device is required");
    });

    it("rejects trial when the presented device is owned by a different account", async () => {
      const userAlice = "user-alice";
      const userBob = "user-bob";
      const { deviceId, rawToken } = createTestDevice(userAlice);

      const result = await checkDeviceTrialEligibility({
        userId: userBob,
        deviceId,
        rawToken,
      });

      expect(result.eligible).toBe(false);
      expect(result.code).toBe("DEVICE_NOT_OWNED");
      expect(result.reason).toContain("registered to another account");
    });

    it("rejects trial when the user's device is revoked", async () => {
      const userAlice = "user-alice";
      const { deviceId, rawToken, dev } = createTestDevice(userAlice);
      dev.status = "revoked";
      dev.revokedAt = new Date();

      const result = await checkDeviceTrialEligibility({
        userId: userAlice,
        deviceId,
        rawToken,
      });

      expect(result.eligible).toBe(false);
      expect(result.code).toBe("DEVICE_REVOKED");
      expect(result.reason).toContain("device has been revoked");
    });
  });

  describe("2. Prevent Repeat Trial Claims on Already-Claimed Devices", () => {
    it("successfully records device trial claim on first trial evaluation", async () => {
      const userAlice = "user-alice";
      const { deviceId, rawToken } = createTestDevice(userAlice);

      // Reserve credit for the first time
      const reservation = await reserveEvaluationCredit({
        userId: userAlice,
        deviceId,
        rawToken,
        ipAddress: "196.188.1.100",
      });

      expect(reservation.credits).toBe(1);

      // Device trial claim must now be persisted
      const claim = await getDeviceTrialClaim(deviceId);
      expect(claim).not.toBeNull();
      expect(claim?.userId).toBe(userAlice);
      expect(claim?.deviceId).toBe(deviceId);
      expect(claim?.ipAddress).toBe("196.188.1.100");

      // Device record must have trialClaimedAt stamped
      const updatedDev = inMemory.devices.find((d) => d.deviceId === deviceId);
      expect(updatedDev?.trialClaimedAt).toBeDefined();
    });

    it("rejects a second account attempting to obtain a free trial on an already-claimed device", async () => {
      const userAlice = "user-alice";
      const userEve = "user-eve";
      const { deviceId, rawToken } = createTestDevice(userAlice);

      // User Alice claims the trial on device 1
      await recordDeviceTrialClaim({
        deviceId,
        userId: userAlice,
        ipAddress: "196.188.1.100",
      });

      // User Eve attempts to claim or reserve trial on this same device
      inMemory.devices.find((d) => d.deviceId === deviceId)!.ownerUserId = userEve;

      const eligibility = await checkDeviceTrialEligibility({
        userId: userEve,
        deviceId,
        rawToken,
      });

      expect(eligibility.eligible).toBe(false);
      expect(eligibility.code).toBe("DEVICE_TRIAL_ALREADY_CLAIMED");
      expect(eligibility.reason).toContain("already claimed a free trial under another account");

      // Attempting to reserve evaluation credit must throw ForbiddenError
      await expect(
        reserveEvaluationCredit({
          userId: userEve,
          deviceId,
          rawToken,
        })
      ).rejects.toThrowError(ForbiddenError);
    });

    it("rejects trial claim when device was tombstoned from a previously deleted account", async () => {
      const userFrank = "user-frank";
      const { deviceId, rawToken } = createTestDevice(userFrank);

      // Tombstone the device (simulating previous account deletion)
      inMemory.tombstones.push({
        id: "tomb-1",
        deviceId,
        tokenHash: "some_hash",
        originalOwnerUserId: "deleted-account-999",
        reason: "account_deleted",
        trialConsumed: true,
        tombstonedAt: new Date(),
      });

      const eligibility = await checkDeviceTrialEligibility({
        userId: userFrank,
        deviceId,
        rawToken,
      });

      expect(eligibility.eligible).toBe(false);
      expect(eligibility.code).toBe("DEVICE_TRIAL_ALREADY_CLAIMED");
      expect(eligibility.reason).toContain("previously registered to an account that consumed its free trial");
    });
  });

  describe("3. Independent Auditability: Changing Device Preserves Account Trial History", () => {
    it("does not reset account trial history when a device changes or is replaced", async () => {
      const userAlice = "user-alice";
      const dev1 = createTestDevice(userAlice, "Alice Device 1");

      // Alice uses 2 of her 3 trial evaluations on Device 1
      inMemory.counters.push({
        id: "cnt-1",
        userId: userAlice,
        periodKey: `trial:${userAlice}`,
        evaluationsUsed: 2,
        evaluationsReserved: 0,
      });

      await recordDeviceTrialClaim({
        deviceId: dev1.deviceId,
        userId: userAlice,
      });

      // Verify trial history before device replacement
      const historyBefore = await getAccountTrialHistory(userAlice);
      expect(historyBefore.evaluationsUsed).toBe(2);
      expect(historyBefore.remaining).toBe(1);
      expect(historyBefore.claims).toHaveLength(1);
      expect(historyBefore.claims[0].deviceId).toBe(dev1.deviceId);

      // Alice replaces Device 1 with Device 2 (e.g. via device recovery)
      dev1.dev.status = "revoked";
      dev1.dev.revokedAt = new Date();
      const dev2 = createTestDevice(userAlice, "Alice Replacement Device");

      // Verify Device 2 eligibility for Alice
      const dev2Eligibility = await checkDeviceTrialEligibility({
        userId: userAlice,
        deviceId: dev2.deviceId,
        rawToken: dev2.rawToken,
      });

      // Alice is eligible to use her remaining 1 evaluation on Device 2
      expect(dev2Eligibility.eligible).toBe(true);

      // Verify Alice's account trial history: it must NOT be reset to 0 used / 3 remaining
      const historyAfter = await getAccountTrialHistory(userAlice);
      expect(historyAfter.evaluationsUsed).toBe(2);
      expect(historyAfter.remaining).toBe(1); // STILL 1, NOT RESET TO 3!

      // Device 1 remains claimed and independently auditable
      const dev1Claim = await getDeviceTrialClaim(dev1.deviceId);
      expect(dev1Claim).not.toBeNull();
      expect(dev1Claim?.userId).toBe(userAlice);

      // A different user Bob cannot use Device 1
      const bobCheck = await checkDeviceTrialEligibility({
        userId: "user-bob",
        deviceId: dev1.deviceId,
      });
      expect(bobCheck.eligible).toBe(false);
    });
  });

  describe("4. Ambiguous Fingerprint Matches and Shared IP Handling", () => {
    it("does NOT block users who share the same IP address; flags for review instead of unsupported certainty", async () => {
      const sharedIp = "196.188.10.50"; // Standard Ethiopian ISP public IP (Ethio Telecom)

      // User 1 claims a trial from sharedIp
      const user1 = "user-1";
      const dev1 = createTestDevice(user1);
      await recordDeviceTrialClaim({
        deviceId: dev1.deviceId,
        userId: user1,
        ipAddress: sharedIp,
      });

      // User 2 registers a completely distinct device from the same sharedIp (e.g. university / cafe)
      const user2 = "user-2";
      const dev2 = createTestDevice(user2);

      const eligibility = await checkDeviceTrialEligibility({
        userId: user2,
        deviceId: dev2.deviceId,
        rawToken: dev2.rawToken,
        ipAddress: sharedIp,
      });

      // Shared IP alone MUST NOT block users
      expect(eligibility.eligible).toBe(true);
      // Risk outcome must be flagged_for_review rather than blocked
      expect(eligibility.riskOutcome).toBe("flagged_for_review");
      expect(eligibility.riskScore).toBe(30);
      expect(eligibility.riskReason).toBe("shared_ip_address_detected");

      // User 2 can reserve evaluation credit without hard blocking
      const reservation = await reserveEvaluationCredit({
        userId: user2,
        deviceId: dev2.deviceId,
        rawToken: dev2.rawToken,
        ipAddress: sharedIp,
      });

      expect(reservation.credits).toBe(1);
    });
  });

  describe("5. Africa/Addis_Ababa Daily Boundaries and Usage API", () => {
    it("computes daily reset strictly using Africa/Addis_Ababa midnight boundaries", () => {
      const testDateUtc = new Date(Date.UTC(2026, 10, 17, 18, 0, 0));

      const addisDate = getAddisAbabaDateString(testDateUtc);
      expect(addisDate).toBe("2026-11-17");

      const nextMidnight = getAddisAbabaNextMidnight(testDateUtc);
      expect(nextMidnight.toISOString()).toBe("2026-11-17T21:00:00.000Z");

      const startOfDay = getAddisAbabaMidnight(testDateUtc);
      expect(startOfDay.toISOString()).toBe("2026-11-16T21:00:00.000Z");

      const eveningDate = new Date(Date.UTC(2026, 10, 17, 20, 59, 0));
      const nextDayMorning = new Date(Date.UTC(2026, 10, 17, 21, 1, 0));
      expect(isSameAddisAbabaDay(testDateUtc, eveningDate)).toBe(true);
      expect(isSameAddisAbabaDay(testDateUtc, nextDayMorning)).toBe(false);
    });

    it("exposes remaining daily/monthly usage and trial eligibility through authenticated usage summary", async () => {
      const userAlice = "user-alice";
      const { deviceId, rawToken } = createTestDevice(userAlice);

      // Usage summary before any evaluations
      const summaryInitial = await getUserUsageSummary(userAlice, {
        deviceId,
        rawToken,
        ipAddress: "196.188.1.50",
      });

      expect(summaryInitial.quotas.timezone).toBe(ETHIOPIA_TIMEZONE);
      expect(summaryInitial.quotas.trial.isTrial).toBe(true);
      expect(summaryInitial.quotas.trial.limit).toBe(3);
      expect(summaryInitial.quotas.trial.used).toBe(0);
      expect(summaryInitial.quotas.trial.remaining).toBe(3);
      expect(summaryInitial.quotas.trial.eligible).toBe(true);
      expect(summaryInitial.quotas.canEvaluate).toBe(true);
      expect(summaryInitial.quotas.device?.isRegistered).toBe(true);
      expect(summaryInitial.quotas.device?.deviceId).toBe(deviceId);

      // Alice uses 1 evaluation
      inMemory.counters.push({
        id: "cnt-1",
        userId: userAlice,
        periodKey: `trial:${userAlice}`,
        evaluationsUsed: 1,
        evaluationsReserved: 0,
      });

      await recordDeviceTrialClaim({
        deviceId,
        userId: userAlice,
      });

      const summaryAfter = await getUserUsageSummary(userAlice, {
        deviceId,
        rawToken,
      });

      expect(summaryAfter.quotas.trial.used).toBe(1);
      expect(summaryAfter.quotas.trial.remaining).toBe(2);
      expect(summaryAfter.quotas.trial.deviceClaimed).toBe(true);
      expect(summaryAfter.quotas.canEvaluate).toBe(true);
    });

    it("resets paid user daily quota when calendar day advances in Africa/Addis_Ababa", async () => {
      const paidUser = "paid-user-pro";
      const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Set up active Pro Monthly subscription
      inMemory.subscriptions.push({
        id: "sub-1",
        userId: paidUser,
        planId: "plan_pro_monthly",
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: subEnd,
        renewalDate: subEnd,
      });

      const day1Str = "2026-11-17";
      const day2Str = "2026-11-18";

      // On Day 1: user uses all 5 daily evaluations
      inMemory.counters.push({
        id: "c-day1",
        userId: paidUser,
        periodKey: `daily:${paidUser}:${day1Str}`,
        evaluationsUsed: 5,
        evaluationsReserved: 0,
      });
      inMemory.counters.push({
        id: "c-month",
        userId: paidUser,
        periodKey: "sub:sub-1:m0",
        evaluationsUsed: 5,
        evaluationsReserved: 0,
      });

      // Mock date to Day 1
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-17T10:00:00Z")); // 13:00 in Addis Ababa on Nov 17

      const day1Summary = await getUserUsageSummary(paidUser);
      expect(day1Summary.quotas.daily.used).toBe(5);
      expect(day1Summary.quotas.daily.remaining).toBe(0);
      expect(day1Summary.quotas.canEvaluate).toBe(false);

      // Advance time past midnight Africa/Addis_Ababa (21:00 UTC on Nov 17 is 00:00 on Nov 18)
      vi.setSystemTime(new Date("2026-11-17T21:05:00Z")); // 00:05 in Addis Ababa on Nov 18
      expect(getAddisAbabaDateString()).toBe(day2Str);

      // On Day 2: daily counter for day 2 does not exist yet (0 used), so remaining resets to 5!
      const day2Summary = await getUserUsageSummary(paidUser);
      expect(day2Summary.quotas.daily.used).toBe(0);
      expect(day2Summary.quotas.daily.remaining).toBe(5); // Reset back to full daily limit!
      expect(day2Summary.quotas.canEvaluate).toBe(true);

      vi.useRealTimers();
    });
  });
});

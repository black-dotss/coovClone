import { describe, it, expect, vi, beforeEach } from "vitest";
import { assertAdmin } from "@/lib/operations/admin";
import {
  freeDevice,
  updateUserAccountStatus,
  resetUserEvaluationUsage,
  toggleDeviceStatus,
} from "@/lib/operations/crm";
import { ForbiddenError, BadRequestError } from "@/lib/shared/errors";

const superAdmin = {
  id: "admin-israel",
  email: "israelashenafi29@gmail.com",
};

const unauthorizedUser = {
  id: "random-user",
  email: "stranger@example.com",
};

let inMemoryUsers: Record<string, unknown>[] = [];
let inMemoryDevices: Record<string, unknown>[] = [];
let inMemoryClaims: Record<string, unknown>[] = [];
let inMemoryTombstones: Record<string, unknown>[] = [];
let inMemoryProfiles: Record<string, unknown>[] = [];
let inMemoryUsage: Record<string, unknown>[] = [];

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => Promise.resolve(data.slice(0, n)),
    offset: () => Promise.resolve(data),
    orderBy: () => createMockQuery(data),
    leftJoin: () => createMockQuery(data),
    groupBy: () => Promise.resolve(data),
    where: () => createMockQuery(data),
  });
}

vi.mock("@/lib/operations/audit", () => ({
  recordAuditEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/db/schema", () => {
  return {
    users: { _name: "users" },
    userProfiles: { _name: "userProfiles" },
    subscriptions: { _name: "subscriptions" },
    plans: { _name: "plans" },
    usageCounters: { _name: "usageCounters" },
    devices: { _name: "devices" },
    deviceTrialClaims: { _name: "deviceTrialClaims" },
    deviceTombstones: { _name: "deviceTombstones" },
    deviceEvents: { _name: "deviceEvents" },
    evaluations: { _name: "evaluations" },
    paymentOrders: { _name: "paymentOrders" },
    auditEvents: { _name: "auditEvents" },
  };
});

vi.mock("@/lib/db", () => {
  return {
    db: {
      select: () => ({
        from: (table: { _name?: string }) => {
          const name = table?._name;
          if (name === "users") return createMockQuery(inMemoryUsers);
          if (name === "devices") return createMockQuery(inMemoryDevices);
          if (name === "deviceTrialClaims") return createMockQuery(inMemoryClaims);
          if (name === "deviceTombstones") return createMockQuery(inMemoryTombstones);
          if (name === "userProfiles") return createMockQuery(inMemoryProfiles);
          if (name === "usageCounters") return createMockQuery(inMemoryUsage);
          return createMockQuery([]);
        },
      }),
      insert: () => ({
        values: (val: Record<string, unknown>) => {
          const promise = Promise.resolve([val]);
          return Object.assign(promise, {
            returning: () => Promise.resolve([val]),
          });
        },
      }),
      update: () => ({
        set: (updates: Record<string, unknown>) => ({
          where: () => {
            return Promise.resolve([updates]);
          },
        }),
      }),
      delete: (table: { _name?: string }) => ({
        where: () => {
          let count = 1;
          if (table?._name === "devices") count = inMemoryDevices.length || 1;
          return {
            returning: () =>
              Promise.resolve(Array.from({ length: count }, (_, i) => ({ id: `del-${i}` }))),
          };
        },
      }),
    },
  };
});

describe("Admin CRM Operations Unit Tests", () => {
  beforeEach(() => {
    inMemoryUsers = [
      {
        id: "user-123",
        email: "candidate@example.com",
        name: "Test Candidate",
      },
    ];
    inMemoryDevices = [
      {
        id: "dev-rec-1",
        deviceId: "dev_xyz789",
        ownerUserId: "user-123",
        status: "active",
      },
    ];
    inMemoryClaims = [
      {
        id: "claim-1",
        deviceId: "dev_xyz789",
        userId: "user-123",
      },
    ];
    inMemoryTombstones = [];
    inMemoryProfiles = [
      {
        userId: "user-123",
        accountStatus: "active",
      },
    ];
    inMemoryUsage = [
      {
        userId: "user-123",
        evaluationsUsed: 3,
        evaluationsReserved: 1,
      },
    ];
  });

  describe("assertAdmin Privilege Enforcement", () => {
    it("authorizes israelashenafi29@gmail.com without restriction", () => {
      expect(() => assertAdmin(superAdmin)).not.toThrow();
    });

    it("authorizes case-insensitively with leading/trailing spaces", () => {
      expect(() =>
        assertAdmin({ id: "admin-2", email: "  ISRAELASHENAFI29@GMAIL.COM  " })
      ).not.toThrow();
    });

    it("rejects unauthorized user accounts", () => {
      expect(() => assertAdmin(unauthorizedUser)).toThrow(ForbiddenError);
    });
  });

  describe("freeDevice Restrictions Bypass Engine", () => {
    it("frees a device by deviceId successfully", async () => {
      const result = await freeDevice({ deviceId: "dev_xyz789" }, superAdmin);
      expect(result.success).toBe(true);
      expect(result.freedCount).toBeGreaterThan(0);
      expect(result.message).toContain("dev_xyz789");
    });

    it("frees all devices for a given user email", async () => {
      const result = await freeDevice({ userEmail: "candidate@example.com" }, superAdmin);
      expect(result.success).toBe(true);
      expect(result.freedCount).toBeGreaterThan(0);
      expect(result.message).toContain("candidate@example.com");
    });

    it("rejects request if neither deviceId nor userEmail is provided", async () => {
      await expect(freeDevice({}, superAdmin)).rejects.toThrow(BadRequestError);
    });
  });

  describe("updateUserAccountStatus and resetUserEvaluationUsage", () => {
    it("updates user account status to suspended", async () => {
      const result = await updateUserAccountStatus("user-123", "suspended", superAdmin);
      expect(result.success).toBe(true);
      expect(result.status).toBe("suspended");
    });

    it("resets user evaluation quota to zero", async () => {
      const result = await resetUserEvaluationUsage("user-123", superAdmin);
      expect(result.success).toBe(true);
      expect(result.message).toContain("quota has been successfully reset to 0");
    });

    it("toggles device active/revoked status", async () => {
      const result = await toggleDeviceStatus("dev_xyz789", "revoked", superAdmin);
      expect(result.success).toBe(true);
      expect(result.status).toBe("revoked");
    });
  });
});

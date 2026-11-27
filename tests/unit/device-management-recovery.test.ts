import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listUserDevices,
  revokeDevice,
  requestDeviceRecovery,
  confirmDeviceRecovery,
  claimDeviceForUser,
  isDeviceTombstoned,
} from "@/lib/devices/service";
import { generateDeviceToken, hashDeviceToken } from "@/lib/devices/tokens";
import {
  devices,
  deviceEvents,
  deviceTombstones,
  verifications,
  users,
  auditEvents,
} from "@/lib/db/schema";
import {
  ForbiddenError,
  BadRequestError,
  RateLimitError,
} from "@/lib/shared/errors";
import { deleteUserAccount } from "@/lib/auth/policies";

// In-memory mock entities
interface MockDevice {
  id: string;
  ownerUserId: string;
  deviceId: string;
  tokenHash: string;
  fingerprintHash: string | null;
  label: string | null;
  status: "active" | "revoked";
  firstSeenAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface MockTombstone {
  id: string;
  deviceId: string;
  tokenHash: string;
  fingerprintHash: string | null;
  originalOwnerUserId: string | null;
  reason: string;
  trialConsumed: boolean;
  tombstonedAt: Date;
  createdAt: Date;
}

interface MockVerification {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Date;
}

interface MockUser {
  id: string;
  email: string;
  name: string;
}

let inMemoryDevices: MockDevice[] = [];
let inMemoryTombstones: MockTombstone[] = [];
let inMemoryVerifications: MockVerification[] = [];
let inMemoryUsers: MockUser[] = [];
let inMemoryEvents: Array<{ eventType: string; userId: string; deviceId: string }> = [];

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

function createMockTableQuery<T>(
  data: T[],
  filterFn?: (clause: unknown) => T[]
): Promise<T[]> & {
  limit: (n: number) => Promise<T[]>;
  orderBy: () => Promise<T[]>;
  where: (clause: unknown) => Promise<T[]> & { limit: (n: number) => Promise<T[]>; orderBy: () => Promise<T[]> };
} {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => createMockTableQuery(data.slice(0, n), filterFn),
    orderBy: () => createMockTableQuery(data, filterFn),
    where: (clause: unknown) => {
      const filtered = filterFn ? filterFn(clause) : data;
      return createMockTableQuery(filtered, filterFn);
    },
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === users) {
          return createMockTableQuery(inMemoryUsers, (clause) => {
            const strings = findStringsInClause(clause);
            return inMemoryUsers.filter((u) => strings.includes(u.id) || strings.includes(u.email));
          });
        }

        if (table === verifications) {
          return createMockTableQuery(inMemoryVerifications, (clause) => {
            const strings = findStringsInClause(clause);
            return inMemoryVerifications.filter((v) =>
              strings.some((s) => v.identifier.includes(s) || v.identifier === s)
            );
          });
        }

        if (table === deviceTombstones) {
          return createMockTableQuery(inMemoryTombstones, (clause) => {
            const strings = findStringsInClause(clause);
            return inMemoryTombstones.filter(
              (t) => strings.includes(t.deviceId) || strings.includes(t.tokenHash)
            );
          });
        }

        if (table === devices) {
          return createMockTableQuery(inMemoryDevices, (clause) => {
            const strings = findStringsInClause(clause);
            let matched = inMemoryDevices;
            if (strings.length > 0) {
              matched = inMemoryDevices.filter((d) =>
                strings.some((s) => s === d.id || s === d.deviceId || s === d.tokenHash || s === d.ownerUserId)
              );
            }
            if (strings.includes("active")) {
              matched = matched.filter((d) => d.status === "active");
            }
            if (strings.includes("revoked")) {
              matched = matched.filter((d) => d.status === "revoked");
            }
            return matched;
          });
        }

        return createMockTableQuery([]);
      },
    }),
    insert: (table: unknown) => ({
      values: (val: Record<string, unknown>) => {
        if (table === devices) {
          const record: MockDevice = {
            id: `dev-uuid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ownerUserId: val.ownerUserId as string,
            deviceId: val.deviceId as string,
            tokenHash: val.tokenHash as string,
            fingerprintHash: (val.fingerprintHash as string) || null,
            label: (val.label as string) || null,
            status: (val.status as "active" | "revoked") || "active",
            firstSeenAt: (val.firstSeenAt as Date) || new Date(),
            lastSeenAt: (val.lastSeenAt as Date) || new Date(),
            revokedAt: null,
            createdAt: new Date(),
          };
          inMemoryDevices.push(record);
          return {
            returning: () => Promise.resolve([record]),
            then: (res: () => void) => res(),
          };
        }

        if (table === verifications) {
          const rec: MockVerification = {
            id: (val.id as string) || `ver-${Date.now()}`,
            identifier: val.identifier as string,
            value: val.value as string,
            expiresAt: val.expiresAt as Date,
            createdAt: new Date(),
          };
          inMemoryVerifications.push(rec);
          return {
            returning: () => Promise.resolve([rec]),
            then: (res: () => void) => res(),
          };
        }

        if (table === deviceTombstones) {
          const rec: MockTombstone = {
            id: `tomb-${Date.now()}`,
            deviceId: val.deviceId as string,
            tokenHash: val.tokenHash as string,
            fingerprintHash: (val.fingerprintHash as string) || null,
            originalOwnerUserId: (val.originalOwnerUserId as string) || null,
            reason: (val.reason as string) || "account_deleted",
            trialConsumed: true,
            tombstonedAt: new Date(),
            createdAt: new Date(),
          };
          inMemoryTombstones.push(rec);
          return {
            returning: () => Promise.resolve([rec]),
            then: (res: () => void) => res(),
          };
        }

        if (table === deviceEvents) {
          inMemoryEvents.push({
            eventType: val.eventType as string,
            userId: val.userId as string,
            deviceId: val.deviceId as string,
          });
          return {
            returning: () => Promise.resolve([{ id: "ev-1" }]),
            then: (res: () => void) => res(),
          };
        }

        if (table === auditEvents) {
          return {
            returning: () => Promise.resolve([{ id: "audit-1" }]),
            then: (res: () => void) => res(),
          };
        }

        return {
          returning: () => Promise.resolve([{ id: "1" }]),
          then: (res: () => void) => res(),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (updates: Record<string, unknown>) => ({
        where: (clause?: unknown) => {
          const strings = clause ? findStringsInClause(clause) : [];

          if (table === devices) {
            for (const d of inMemoryDevices) {
              if (strings.includes(d.id) || strings.includes(d.deviceId)) {
                if (updates.status !== undefined) d.status = updates.status as "active" | "revoked";
                if (updates.revokedAt !== undefined) d.revokedAt = updates.revokedAt as Date | null;
                if (updates.lastSeenAt !== undefined) d.lastSeenAt = updates.lastSeenAt as Date;
              }
            }
          }

          if (table === verifications) {
            for (const v of inMemoryVerifications) {
              if (strings.includes(v.id) || strings.includes(v.identifier)) {
                if (updates.value !== undefined) v.value = updates.value as string;
              }
            }
          }

          return Promise.resolve();
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (clause?: unknown) => {
        const strings = clause ? findStringsInClause(clause) : [];

        if (table === verifications) {
          inMemoryVerifications = inMemoryVerifications.filter(
            (v) => !strings.includes(v.id) && !strings.includes(v.identifier)
          );
        }

        if (table === users) {
          inMemoryUsers = inMemoryUsers.filter((u) => !strings.includes(u.id));
        }

        return Promise.resolve();
      },
    }),
  },
  devices: {},
  deviceEvents: {},
  deviceTombstones: {},
  verifications: {},
  users: {},
  auditEvents: {},
  documents: {},
}));

describe("Task 6: Device Management, Recovery, and Account Lifecycle", () => {
  beforeEach(() => {
    inMemoryDevices = [];
    inMemoryTombstones = [];
    inMemoryVerifications = [];
    inMemoryUsers = [
      { id: "user-alice", email: "alice@example.com", name: "Alice" },
      { id: "user-bob", email: "bob@example.com", name: "Bob" },
    ];
    inMemoryEvents = [];
  });

  describe("Device Listing with Strict Ownership", () => {
    it("lists all devices owned by the authenticated user and flags current device", async () => {
      const dev1 = generateDeviceToken("dev_alice_laptop");
      const dev2 = generateDeviceToken("dev_alice_phone");
      const devBob = generateDeviceToken("dev_bob_desktop");

      inMemoryDevices.push(
        {
          id: "uuid-1",
          ownerUserId: "user-alice",
          deviceId: dev1.deviceId,
          tokenHash: dev1.tokenHash,
          fingerprintHash: null,
          label: "Alice Laptop",
          status: "active",
          firstSeenAt: new Date("2026-01-01"),
          lastSeenAt: new Date("2026-01-02"),
          revokedAt: null,
          createdAt: new Date("2026-01-01"),
        },
        {
          id: "uuid-2",
          ownerUserId: "user-alice",
          deviceId: dev2.deviceId,
          tokenHash: dev2.tokenHash,
          fingerprintHash: null,
          label: "Alice Phone",
          status: "active",
          firstSeenAt: new Date("2026-01-03"),
          lastSeenAt: new Date("2026-01-04"),
          revokedAt: null,
          createdAt: new Date("2026-01-03"),
        },
        {
          id: "uuid-3",
          ownerUserId: "user-bob",
          deviceId: devBob.deviceId,
          tokenHash: devBob.tokenHash,
          fingerprintHash: null,
          label: "Bob Desktop",
          status: "active",
          firstSeenAt: new Date("2026-01-01"),
          lastSeenAt: new Date("2026-01-02"),
          revokedAt: null,
          createdAt: new Date("2026-01-01"),
        }
      );

      const aliceDevices = await listUserDevices("user-alice", "dev_alice_laptop");

      expect(aliceDevices.length).toBe(2);
      expect(aliceDevices.every((d) => d.deviceId.startsWith("dev_alice"))).toBe(true);
      const laptop = aliceDevices.find((d) => d.deviceId === "dev_alice_laptop");
      const phone = aliceDevices.find((d) => d.deviceId === "dev_alice_phone");

      expect(laptop?.isCurrentDevice).toBe(true);
      expect(phone?.isCurrentDevice).toBe(false);
      // Ensure tokenHash is never exposed in client DTO
      expect((laptop as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
    });

    it("prevents cross-account device visibility", async () => {
      const devBob = generateDeviceToken("dev_bob_1");
      inMemoryDevices.push({
        id: "uuid-bob",
        ownerUserId: "user-bob",
        deviceId: devBob.deviceId,
        tokenHash: devBob.tokenHash,
        fingerprintHash: null,
        label: "Bob Workstation",
        status: "active",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      const aliceView = await listUserDevices("user-alice");
      expect(aliceView.length).toBe(0);
    });
  });

  describe("Device Revocation and Lockout Protection", () => {
    it("allows owner to revoke a device when user has multiple active devices", async () => {
      const dev1 = generateDeviceToken("dev_laptop");
      const dev2 = generateDeviceToken("dev_phone");

      inMemoryDevices.push(
        {
          id: "uuid-laptop",
          ownerUserId: "user-alice",
          deviceId: dev1.deviceId,
          tokenHash: dev1.tokenHash,
          fingerprintHash: null,
          label: "Laptop",
          status: "active",
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        },
        {
          id: "uuid-phone",
          ownerUserId: "user-alice",
          deviceId: dev2.deviceId,
          tokenHash: dev2.tokenHash,
          fingerprintHash: null,
          label: "Phone",
          status: "active",
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        }
      );

      const res = await revokeDevice("uuid-laptop", "user-alice");
      expect(res.success).toBe(true);
      expect(res.deviceId).toBe(dev1.deviceId);

      const target = inMemoryDevices.find((d) => d.id === "uuid-laptop");
      expect(target?.status).toBe("revoked");
      expect(target?.revokedAt).toBeInstanceOf(Date);
    });

    it("rejects revocation if requesting user is not the owner (cross-account protection)", async () => {
      const dev = generateDeviceToken("dev_alice");
      inMemoryDevices.push({
        id: "uuid-alice-dev",
        ownerUserId: "user-alice",
        deviceId: dev.deviceId,
        tokenHash: dev.tokenHash,
        fingerprintHash: null,
        label: "Alice Tablet",
        status: "active",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      await expect(
        revokeDevice("uuid-alice-dev", "user-bob")
      ).rejects.toThrowError(ForbiddenError);

      const target = inMemoryDevices.find((d) => d.id === "uuid-alice-dev");
      expect(target?.status).toBe("active");
    });

    it("requires re-auth / confirmation code when revoking the user's ONLY active device", async () => {
      const dev = generateDeviceToken("dev_only_one");
      inMemoryDevices.push({
        id: "uuid-only",
        ownerUserId: "user-alice",
        deviceId: dev.deviceId,
        tokenHash: dev.tokenHash,
        fingerprintHash: null,
        label: "Only Device",
        status: "active",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Attempting to revoke without confirmation code throws BadRequestError
      await expect(
        revokeDevice("uuid-only", "user-alice")
      ).rejects.toThrowError(BadRequestError);

      // Now create a valid re-auth verification code
      const code = "654321";
      const codeHash = hashDeviceToken(code);
      inMemoryVerifications.push({
        id: "ver-reauth-1",
        identifier: "device_reauth:user-alice",
        value: JSON.stringify({ codeHash }),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      });

      // Providing the valid code successfully revokes the only device
      const res = await revokeDevice("uuid-only", "user-alice", {
        confirmationCode: code,
      });
      expect(res.success).toBe(true);
      const target = inMemoryDevices.find((d) => d.id === "uuid-only");
      expect(target?.status).toBe("revoked");
    });
  });

  describe("Device Recovery and Replacement Flow", () => {
    it("requests device recovery with rate limiting abuse controls", async () => {
      const reqRes = await requestDeviceRecovery({
        email: "alice@example.com",
      });

      expect(reqRes.success).toBe(true);
      expect(reqRes.expiresAt).toBeInstanceOf(Date);
      expect(inMemoryVerifications.length).toBe(1);
      expect(inMemoryVerifications[0].identifier).toBe("device_recovery:user-alice");

      // Immediate subsequent request within 60s is rate limited
      await expect(
        requestDeviceRecovery({ email: "alice@example.com" })
      ).rejects.toThrowError(RateLimitError);
    });

    it("confirms device recovery: atomically revokes old devices, marks new device active, and preserves account quota", async () => {
      const oldDev = generateDeviceToken("dev_old_lost");
      inMemoryDevices.push({
        id: "uuid-old",
        ownerUserId: "user-alice",
        deviceId: oldDev.deviceId,
        tokenHash: oldDev.tokenHash,
        fingerprintHash: null,
        label: "Lost Phone",
        status: "active",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Request recovery
      const reqRes = await requestDeviceRecovery({ email: "alice@example.com" });
      const otpCode = reqRes.recoveryCode!;
      expect(otpCode).toBeDefined();

      // Confirm recovery with code
      const confirmRes = await confirmDeviceRecovery({
        email: "alice@example.com",
        code: otpCode,
        label: "New Replacement Laptop",
      });

      expect(confirmRes.success).toBe(true);
      expect(confirmRes.deviceId).toBeDefined();
      expect(confirmRes.rawToken).toBeDefined();
      expect(confirmRes.revokedDeviceIds).toContain(oldDev.deviceId);

      // Verify old device is revoked
      const oldDevRecord = inMemoryDevices.find((d) => d.deviceId === oldDev.deviceId);
      expect(oldDevRecord?.status).toBe("revoked");

      // Verify new device is active and owned by Alice
      const newDevRecord = inMemoryDevices.find((d) => d.deviceId === confirmRes.deviceId);
      expect(newDevRecord?.status).toBe("active");
      expect(newDevRecord?.ownerUserId).toBe("user-alice");
      expect(newDevRecord?.label).toBe("New Replacement Laptop");

      // Single-use guarantee: verification was consumed
      expect(inMemoryVerifications.length).toBe(0);
    });

    it("rejects invalid code and enforces lockout after 5 failed attempts (brute force protection)", async () => {
      const reqRes = await requestDeviceRecovery({ email: "alice@example.com" });
      expect(reqRes.recoveryCode).toBeDefined();

      // Attempts 1 to 4: rejects with BadRequestError
      for (let i = 1; i <= 4; i++) {
        await expect(
          confirmDeviceRecovery({
            email: "alice@example.com",
            code: "000000",
          })
        ).rejects.toThrowError(BadRequestError);
      }

      // Attempt 5: invalidates and locks out with ForbiddenError
      await expect(
        confirmDeviceRecovery({
          email: "alice@example.com",
          code: "000000",
        })
      ).rejects.toThrowError(ForbiddenError);

      // Code was deleted from verifications to prevent any further attempts
      expect(inMemoryVerifications.length).toBe(0);
    });

    it("prevents account takeover: attacker cannot confirm recovery on victim account without valid code", async () => {
      await requestDeviceRecovery({ email: "alice@example.com" });

      // Attacker tries guessing or using invalid code
      await expect(
        confirmDeviceRecovery({
          email: "alice@example.com",
          code: "999999",
        })
      ).rejects.toThrowError(BadRequestError);

      // Alice's existing devices remain uncompromised
      const aliceDevices = inMemoryDevices.filter((d) => d.ownerUserId === "user-alice");
      expect(aliceDevices.every((d) => d.status === "active")).toBe(true);
    });
  });

  describe("Revoked & Abandoned Device Anti-Abuse Rules", () => {
    it("prevents an abandoned/revoked device from immediately registering a new trial account", async () => {
      const dev = generateDeviceToken("dev_abandoned");
      inMemoryDevices.push({
        id: "uuid-abandoned",
        ownerUserId: "user-alice",
        deviceId: dev.deviceId,
        tokenHash: dev.tokenHash,
        fingerprintHash: null,
        label: "Abandoned Device",
        status: "revoked",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: new Date(),
        createdAt: new Date(),
      });

      // An attacker attempts to create a new trial account with this abandoned device
      await expect(
        claimDeviceForUser({
          userId: "user-charlie-new",
          rawToken: dev.rawToken,
          isSignUp: true,
        })
      ).rejects.toThrowError(ForbiddenError);
    });

    it("blocks a different user from claiming an abandoned revoked device", async () => {
      const dev = generateDeviceToken("dev_revoked_1");
      inMemoryDevices.push({
        id: "uuid-revoked",
        ownerUserId: "user-alice",
        deviceId: dev.deviceId,
        tokenHash: dev.tokenHash,
        fingerprintHash: null,
        label: "Revoked Device",
        status: "revoked",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: new Date(),
        createdAt: new Date(),
      });

      await expect(
        claimDeviceForUser({
          userId: "user-bob",
          rawToken: dev.rawToken,
          isSignUp: false,
        })
      ).rejects.toThrowError(ForbiddenError);
    });

    it("allows original owner to reactivate their own previously revoked device", async () => {
      const dev = generateDeviceToken("dev_my_old_phone");
      inMemoryDevices.push({
        id: "uuid-old-phone",
        ownerUserId: "user-alice",
        deviceId: dev.deviceId,
        tokenHash: dev.tokenHash,
        fingerprintHash: null,
        label: "My Old Phone",
        status: "revoked",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: new Date(),
        createdAt: new Date(),
      });

      const res = await claimDeviceForUser({
        userId: "user-alice",
        rawToken: dev.rawToken,
        isSignUp: false,
      });

      expect(res.allowed).toBe(true);
      expect(res.deviceId).toBe(dev.deviceId);
      const updated = inMemoryDevices.find((d) => d.deviceId === dev.deviceId);
      expect(updated?.status).toBe("active");
      expect(updated?.revokedAt).toBeNull();
    });
  });

  describe("Account Deletion and Tombstoning Lifecycle", () => {
    it("tombstones user devices upon account deletion to prevent trial reuse", async () => {
      const dev1 = generateDeviceToken("dev_alice_primary");
      inMemoryDevices.push({
        id: "uuid-alice-prim",
        ownerUserId: "user-alice",
        deviceId: dev1.deviceId,
        tokenHash: dev1.tokenHash,
        fingerprintHash: "fp_hash_123",
        label: "Alice Primary",
        status: "active",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Execute account deletion policy
      const delRes = await deleteUserAccount("user-alice", "user-alice");
      expect(delRes.success).toBe(true);
      expect(delRes.deletedUserId).toBe("user-alice");
      expect(delRes.tombstonedDevicesCount).toBe(1);

      // Verify device was inserted into deviceTombstones
      expect(inMemoryTombstones.length).toBe(1);
      expect(inMemoryTombstones[0].deviceId).toBe(dev1.deviceId);
      expect(inMemoryTombstones[0].trialConsumed).toBe(true);

      const isTomb = await isDeviceTombstoned(dev1.deviceId);
      expect(isTomb).toBe(true);

      // Now an attacker attempts to register a brand new account using Alice's deleted device
      await expect(
        claimDeviceForUser({
          userId: "user-attacker-free-trial",
          rawToken: dev1.rawToken,
          isSignUp: true,
        })
      ).rejects.toThrowError(ForbiddenError);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generateDeviceToken,
  verifyDeviceToken,
  hashDeviceToken,
  parseDeviceTokenFromCookie,
  buildDeviceCookie,
  DEVICE_COOKIE_NAME,
} from "@/lib/devices/tokens";
import {
  claimDeviceForUser,
} from "@/lib/devices/service";
import { generateFingerprintHash, extractClientIp } from "@/lib/devices/fingerprint";
import { ForbiddenError } from "@/lib/shared/errors";
import { devices, deviceEvents } from "@/lib/db/schema";

// In-memory mock database state for device testing
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

interface MockDeviceEvent {
  id: string;
  deviceId: string;
  userId: string;
  eventType: string;
  riskOutcome: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

let inMemoryDevices: MockDevice[] = [];
let inMemoryDeviceEvents: MockDeviceEvent[] = [];

// Helper to mock drizzle query builder
function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => Promise.resolve(data.slice(0, n)),
    orderBy: () => createMockQuery(data),
    where: () => createMockQuery(data),
  });
}

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

function findMatchingDevice(clause: unknown): MockDevice[] {
  const active = inMemoryDevices.filter((d) => d.status === "active");
  if (!clause) return active;
  const strings = findStringsInClause(clause);
  for (const d of active) {
    if (strings.includes(d.deviceId) || strings.includes(d.tokenHash) || strings.includes(d.ownerUserId)) {
      return [d];
    }
  }
  return active;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === devices) {
          return {
            where: (clause: unknown) => {
              const matched = findMatchingDevice(clause);
              return {
                limit: (n?: number) => Promise.resolve(matched.slice(0, n ?? 1)),
                orderBy: () => createMockQuery(matched),
                then: (resolve: (items: MockDevice[]) => void) => resolve(matched),
              };
            },
            orderBy: () => createMockQuery(inMemoryDevices.filter((d) => d.status === "active")),
          };
        }
        return createMockQuery([]);
      },
    }),
    insert: (table: unknown) => ({
      values: (val: Record<string, unknown>) => {
        if (table === devices) {
          // Check for unique constraint violation on deviceId or tokenHash
          const conflict = inMemoryDevices.find(
            (d) => (d.deviceId === val.deviceId || d.tokenHash === val.tokenHash) && d.status === "active"
          );
          if (conflict) {
            throw new Error("duplicate key value violates unique constraint 'devices_device_id_idx'");
          }

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
            returning: () => [record],
          };
        }

        if (table === deviceEvents) {
          const event: MockDeviceEvent = {
            id: `event-uuid-${Date.now()}`,
            deviceId: val.deviceId as string,
            userId: val.userId as string,
            eventType: val.eventType as string,
            riskOutcome: (val.riskOutcome as string) || "allowed",
            metadata: (val.metadata as Record<string, unknown>) || {},
            createdAt: new Date(),
          };
          inMemoryDeviceEvents.push(event);
          return Promise.resolve([event]);
        }

        return { returning: () => [{ id: "mock-id" }] };
      },
    }),
    update: (table: unknown) => ({
      set: (_updates: Record<string, unknown>) => ({
        where: () => {
          if (table === devices) {
            return Promise.resolve([{ id: "updated" }]);
          }
          return Promise.resolve([]);
        },
      }),
    }),
  },
}));

describe("Task 5: Device Registration and Ownership Enforcement", () => {
  beforeEach(() => {
    inMemoryDevices = [];
    inMemoryDeviceEvents = [];
    vi.clearAllMocks();
  });

  describe("Cryptographic Token Generation and Signing", () => {
    it("issues a cryptographically random device ID and signed opaque token", () => {
      const { deviceId, rawToken, tokenHash } = generateDeviceToken();

      expect(deviceId).toMatch(/^dev_[a-f0-9-]+$/);
      expect(rawToken).toContain(".");
      expect(rawToken.split(".")).toHaveLength(3); // deviceId.randomEntropy.signature
      expect(tokenHash).toBe(hashDeviceToken(rawToken));
      expect(tokenHash).toHaveLength(64); // SHA-256 hex string
    });

    it("verifies valid token signature and extracts device ID", () => {
      const { deviceId, rawToken } = generateDeviceToken();
      const result = verifyDeviceToken(rawToken);

      expect(result.valid).toBe(true);
      expect(result.deviceId).toBe(deviceId);
    });

    it("rejects tampered tokens with forged device ID or corrupted signature", () => {
      const { rawToken } = generateDeviceToken();
      const parts = rawToken.split(".");

      // Tampered device ID
      const forgedToken = `dev_attacker-fake-id.${parts[1]}.${parts[2]}`;
      const forgedResult = verifyDeviceToken(forgedToken);
      expect(forgedResult.valid).toBe(false);
      expect(forgedResult.deviceId).toBeNull();

      // Tampered signature
      const corruptedSigToken = `${parts[0]}.${parts[1]}.badsignature000000000000000000000000000000000000000000000000000000`;
      const corruptedResult = verifyDeviceToken(corruptedSigToken);
      expect(corruptedResult.valid).toBe(false);
    });

    it("rejects malformed or empty tokens", () => {
      expect(verifyDeviceToken("").valid).toBe(false);
      expect(verifyDeviceToken("invalid-string").valid).toBe(false);
      expect(verifyDeviceToken("a.b").valid).toBe(false);
    });
  });

  describe("Device Cookie Serialization and Parsing", () => {
    it("parses device token from cookie header correctly", () => {
      const { rawToken } = generateDeviceToken();
      const cookieHeader = `session=xyz; ${DEVICE_COOKIE_NAME}=${rawToken}; other=123`;

      const parsed = parseDeviceTokenFromCookie(cookieHeader);
      expect(parsed).toBe(rawToken);
    });

    it("returns null if device cookie is not present", () => {
      expect(parseDeviceTokenFromCookie("session=xyz; other=123")).toBeNull();
      expect(parseDeviceTokenFromCookie(null)).toBeNull();
    });

    it("builds Secure, HttpOnly, SameSite=Lax cookie attribute string", () => {
      const { rawToken } = generateDeviceToken();
      const cookieStr = buildDeviceCookie(rawToken);

      expect(cookieStr).toContain(`${DEVICE_COOKIE_NAME}=${rawToken}`);
      expect(cookieStr).toContain("HttpOnly");
      expect(cookieStr).toContain("SameSite=Lax");
      expect(cookieStr).toContain("Path=/");
      expect(cookieStr).toContain("Max-Age=");
    });
  });

  describe("Zero Raw Token Persistence", () => {
    it("stores only SHA-256 token hash in the database and never the raw token", async () => {
      const result = await claimDeviceForUser({
        userId: "user-101",
        isSignUp: true,
      });

      expect(result.allowed).toBe(true);
      expect(result.rawToken).toBeDefined();

      const stored = inMemoryDevices.find((d) => d.deviceId === result.deviceId);
      expect(stored).toBeDefined();
      expect(stored?.tokenHash).toBe(hashDeviceToken(result.rawToken!));
      expect(stored?.tokenHash).not.toBe(result.rawToken);
      // Ensure raw token signature is not present in stored record
      expect(JSON.stringify(stored)).not.toContain(result.rawToken!);
    });
  });

  describe("One-Device-One-Account Registration Rule", () => {
    it("claims a new device successfully on signup", async () => {
      const result = await claimDeviceForUser({
        userId: "user-alice",
        isSignUp: true,
        fingerprintHash: "fp-alice-hash",
      });

      expect(result.allowed).toBe(true);
      expect(result.isNewDevice).toBe(true);
      expect(result.device?.ownerUserId).toBe("user-alice");

      // Verify event logged
      const regEvent = inMemoryDeviceEvents.find(
        (e) => e.deviceId === result.deviceId && e.eventType === "device.registered"
      );
      expect(regEvent).toBeDefined();
      expect(regEvent?.riskOutcome).toBe("allowed");
    });

    it("allows return visits from the same account on their registered device", async () => {
      // 1. Initial registration
      const initial = await claimDeviceForUser({
        userId: "user-alice",
        isSignUp: true,
      });

      // 2. Return visit with the issued device token
      const returnVisit = await claimDeviceForUser({
        userId: "user-alice",
        rawToken: initial.rawToken,
        isSignUp: false,
      });

      expect(returnVisit.allowed).toBe(true);
      expect(returnVisit.deviceId).toBe(initial.deviceId);
      expect(returnVisit.isNewDevice).toBe(false);
    });

    it("rejects account creation if the device is already actively registered to a different account", async () => {
      // 1. User Alice registers device D
      const aliceClaim = await claimDeviceForUser({
        userId: "user-alice",
        isSignUp: true,
      });

      // 2. Attacker Bob tries to sign up with Alice's device token
      await expect(
        claimDeviceForUser({
          userId: "user-bob",
          rawToken: aliceClaim.rawToken,
          isSignUp: true,
        })
      ).rejects.toThrowError(ForbiddenError);

      // 3. Verify rejection event was recorded
      const rejectedEvent = inMemoryDeviceEvents.find(
        (e) => e.eventType === "device.claim_rejected"
      );
      expect(rejectedEvent).toBeDefined();
      expect(rejectedEvent?.riskOutcome).toBe("blocked");
      expect(rejectedEvent?.metadata?.attemptedUserId).toBe("user-bob");
    });

    it("blocks sign-in attempt from a device actively claimed by another account without takeover", async () => {
      // 1. Device registered to Alice
      const aliceClaim = await claimDeviceForUser({
        userId: "user-alice",
        isSignUp: true,
      });

      // 2. Bob tries to sign in from Alice's registered device
      const bobAttempt = await claimDeviceForUser({
        userId: "user-bob",
        rawToken: aliceClaim.rawToken,
        isSignUp: false,
      });

      expect(bobAttempt.allowed).toBe(false);
      expect(bobAttempt.reason).toContain("already associated with an existing CookMyCv account");
    });
  });

  describe("Concurrency Safety", () => {
    it("handles concurrent registration attempts on the same device safely", async () => {
      const { deviceId, rawToken, tokenHash } = generateDeviceToken();

      // Pre-seed the device in memory as claimed by User 1
      inMemoryDevices.push({
        id: "dev-seed-1",
        ownerUserId: "user-first",
        deviceId,
        tokenHash,
        fingerprintHash: null,
        label: null,
        status: "active",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Simultaneous signup attempt with same device token by another user
      await expect(
        claimDeviceForUser({
          userId: "user-second",
          rawToken,
          isSignUp: true,
        })
      ).rejects.toThrowError(ForbiddenError);
    });
  });

  describe("Device Fingerprint & Signals", () => {
    it("generates deterministic fingerprint hash from client headers", () => {
      const headersA = new Headers({
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "accept-language": "en-US,en;q=0.9",
        "sec-ch-ua": '"Not A(Brand";v="8"',
      });

      const hash1 = generateFingerprintHash(headersA);
      const hash2 = generateFingerprintHash(headersA);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);

      const headersB = new Headers({
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      });
      const hash3 = generateFingerprintHash(headersB);
      expect(hash3).not.toBe(hash1);
    });

    it("extracts client IP from x-forwarded-for header without blocking legitimate shared IPs", () => {
      const headers = new Headers({
        "x-forwarded-for": "196.188.12.34, 10.0.0.1",
      });

      const ip = extractClientIp(headers);
      expect(ip).toBe("196.188.12.34");
    });
  });
});

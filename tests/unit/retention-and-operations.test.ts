import { describe, it, expect, beforeEach, vi } from "vitest";
import { hardDeleteDocument, cleanupExpiredDocuments } from "@/lib/documents/retention";
import { rateLimiter, checkRateLimit, assertRateLimit } from "@/lib/operations/rate-limiter";
import { recordAuditEvent, queryAuditEvents } from "@/lib/operations/audit";
import {
  adminResolvePayment,
  adminUpdatePlan,
  adminRetryJob,
  assertAdmin,
} from "@/lib/operations/admin";
import { captureException } from "@/lib/operations/monitoring";
import { ForbiddenError, NotFoundError, RateLimitError, BadRequestError } from "@/lib/shared/errors";
import {
  documents,
  plans,
  evaluations,
  paymentOrders,
  auditEvents,
  subscriptions,
} from "@/lib/db/schema";

// In-memory test stores
let inMemoryDocs: Array<{ id: string; ownerUserId: string; privateStorageKey: string; filename: string; deletedAt: Date | null }> = [];
let inMemoryAudit: Array<{ id: string; userId: string | null; action: string; targetId: string | null; targetType: string | null; createdAt: Date }> = [];
let inMemoryPlans: Array<{ id: string; name: string; priceEtb: number; dailyLimit: number; monthlyLimit: number; trialAllowance: number; active: boolean }> = [];
let inMemoryEvals: Array<{ id: string; ownerUserId: string; tone: string; status: string; errorMessage: string | null; createdAt: Date; updatedAt: Date }> = [];
let deletedStorageKeys: string[] = [];

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => {
      const p = Promise.resolve(data.slice(0, n));
      return Object.assign(p, {
        offset: (o: number) => Promise.resolve(data.slice(o, o + n)),
      });
    },
    offset: (o: number) => Promise.resolve(data.slice(o)),
    orderBy: () => createMockQuery(data),
    where: () => createMockQuery(data),
    groupBy: () => Promise.resolve([]),
  });
}

vi.mock("@/lib/documents/storage", () => ({
  storage: {
    deleteObject: vi.fn(async (key: string) => {
      deletedStorageKeys.push(key);
    }),
  },
}));

vi.mock("@/lib/payments/service", () => ({
  resolveAmbiguousPaymentOrder: vi.fn(async (orderId: string, adminId: string, action: string) => ({
    id: orderId,
    orderReference: `ORD-ADMIN-${orderId}`,
    status: action === "approve" ? "verified" : "failed",
  })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === documents) return createMockQuery(inMemoryDocs);
        if (table === auditEvents) return createMockQuery(inMemoryAudit);
        if (table === plans) return createMockQuery(inMemoryPlans);
        if (table === evaluations) return createMockQuery(inMemoryEvals);
        if (table === paymentOrders) return createMockQuery([]);
        if (table === subscriptions) return createMockQuery([]);
        return createMockQuery([]);
      },
    }),
    insert: (table: unknown) => ({
      values: (val: Record<string, unknown>) => {
        const record = { id: `id-${Date.now()}`, ...val, createdAt: new Date() };
        if (table === auditEvents) {
          inMemoryAudit.push(record as unknown as (typeof inMemoryAudit)[number]);
        }
        return {
          returning: () => [record],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          if (table === plans && inMemoryPlans.length > 0) {
            Object.assign(inMemoryPlans[0], updates);
            return {
              returning: () => [inMemoryPlans[0]],
            };
          }
          if (table === evaluations && inMemoryEvals.length > 0) {
            Object.assign(inMemoryEvals[0], updates);
          }
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        if (table === documents && inMemoryDocs.length > 0) {
          inMemoryDocs.shift();
        }
        return Promise.resolve();
      },
    }),
  },
  documents: {},
  plans: {},
  evaluations: {},
  paymentOrders: {},
  auditEvents: {},
  subscriptions: {},
}));

describe("File Retention, Rate Limiting, Audit Events, and Admin Tools", () => {
  beforeEach(() => {
    inMemoryDocs = [];
    inMemoryAudit = [];
    inMemoryPlans = [];
    inMemoryEvals = [];
    deletedStorageKeys = [];
    rateLimiter.reset();
  });

  describe("File Deletion and Retention Controls", () => {
    it("hard-deletes document and purges file from object storage", async () => {
      inMemoryDocs.push({
        id: "doc-purge-1",
        ownerUserId: "user-owner",
        privateStorageKey: "documents/user-owner/file.pdf",
        filename: "file.pdf",
        deletedAt: null,
      });

      const result = await hardDeleteDocument("doc-purge-1", "user-owner");
      expect(result.success).toBe(true);
      expect(deletedStorageKeys).toContain("documents/user-owner/file.pdf");
      expect(inMemoryDocs).toHaveLength(0);
    });

    it("prevents unauthorized user from hard deleting someone else's document", async () => {
      inMemoryDocs.push({
        id: "doc-purge-1",
        ownerUserId: "user-owner",
        privateStorageKey: "documents/user-owner/file.pdf",
        filename: "file.pdf",
        deletedAt: null,
      });

      await expect(
        hardDeleteDocument("doc-purge-1", "stranger-user")
      ).rejects.toThrow(ForbiddenError);
    });

    it("runs retention cleanup to purge expired soft-deleted documents", async () => {
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      inMemoryDocs.push({
        id: "doc-expired",
        ownerUserId: "user-owner",
        privateStorageKey: "documents/user-owner/old.pdf",
        filename: "old.pdf",
        deletedAt: sixtyDaysAgo,
      });

      const cleanup = await cleanupExpiredDocuments(30);
      expect(cleanup.purgedCount).toBe(1);
      expect(deletedStorageKeys).toContain("documents/user-owner/old.pdf");
    });
  });

  describe("Rate Limiting and Abuse Protection", () => {
    it("allows requests under the rate limit threshold", () => {
      const res = checkRateLimit("client-ip-1", "api", { maxRequests: 5, windowMs: 1000 });
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(4);
    });

    it("throttles and throws RateLimitError when limit is exceeded", () => {
      const config = { maxRequests: 3, windowMs: 1000 };
      checkRateLimit("client-ip-2", "api", config);
      checkRateLimit("client-ip-2", "api", config);
      checkRateLimit("client-ip-2", "api", config);

      const excess = checkRateLimit("client-ip-2", "api", config);
      expect(excess.allowed).toBe(false);
      expect(excess.retryAfterSeconds).toBeGreaterThan(0);

      expect(() => assertRateLimit("client-ip-2", "api", config)).toThrow(RateLimitError);
    });

    it("triggers temporary abuse block when strike threshold is reached", () => {
      const config = { maxRequests: 2, windowMs: 1000, strikeThreshold: 2, blockDurationMs: 60000 };
      // 2 allowed requests
      checkRateLimit("abuser-ip", "api", config);
      checkRateLimit("abuser-ip", "api", config);

      // Strike 1
      checkRateLimit("abuser-ip", "api", config);
      // Strike 2 -> triggers block
      const blocked = checkRateLimit("abuser-ip", "api", config);

      expect(blocked.allowed).toBe(false);
      expect(blocked.isBlocked).toBe(true);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(50);
    });
  });

  describe("Audit Events & Operational Telemetry", () => {
    it("records audit events with timestamp and query filtering", async () => {
      await recordAuditEvent({
        userId: "user-audit-1",
        action: "report.exported_pdf",
        targetType: "report",
        targetId: "rep-101",
      });

      expect(inMemoryAudit).toHaveLength(1);
      expect(inMemoryAudit[0].action).toBe("report.exported_pdf");

      const queried = await queryAuditEvents({ userId: "user-audit-1" });
      expect(queried).toHaveLength(1);
      expect(queried[0].targetId).toBe("rep-101");
    });

    it("captures runtime exceptions as standardized incident reports", () => {
      const err = new NotFoundError("Requested resource was missing");
      const report = captureException(err, { testContext: "unit-test" });

      expect(report.name).toBe("NotFoundError");
      expect(report.statusCode).toBe(404);
      expect(report.message).toBe("Requested resource was missing");
    });
  });

  describe("Admin Tools (Payments, Plans, Failed Jobs)", () => {
    it("enforces admin authorization checks", () => {
      expect(() => assertAdmin({ id: "user-regular", role: "user" })).toThrow(ForbiddenError);
      expect(() => assertAdmin({ id: "admin-user", role: "admin" })).not.toThrow();
    });

    it("allows admin to review and resolve ambiguous payments", async () => {
      const resolved = await adminResolvePayment("ord-amb-1", "user-admin", "approve", "Approved by admin");
      expect(resolved.status).toBe("verified");
      expect(inMemoryAudit.some((a) => a.action === "admin.payment_reviewed")).toBe(true);
    });

    it("allows admin to update plan pricing and limits with validation", async () => {
      inMemoryPlans.push({
        id: "pro_monthly",
        name: "Pro Monthly",
        priceEtb: 100,
        dailyLimit: 5,
        monthlyLimit: 150,
        trialAllowance: 0,
        active: true,
      });

      const updated = await adminUpdatePlan("pro_monthly", "user-admin", {
        priceEtb: 120,
        dailyLimit: 8,
      });

      expect(updated.priceEtb).toBe(120);
      expect(updated.dailyLimit).toBe(8);

      // Rejects negative price
      await expect(
        adminUpdatePlan("pro_monthly", "user-admin", { priceEtb: -50 })
      ).rejects.toThrow(BadRequestError);
    });

    it("allows admin to retry failed jobs, resetting them to queued", async () => {
      inMemoryEvals.push({
        id: "eval-failed-1",
        ownerUserId: "user-1",
        tone: "strict",
        status: "failed",
        errorMessage: "LLM API timeout",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const retried = await adminRetryJob("eval-failed-1", "user-admin");
      expect(retried.status).toBe("queued");
      expect(inMemoryEvals[0].status).toBe("queued");
      expect(inMemoryEvals[0].errorMessage).toBeNull();
      expect(inMemoryAudit.some((a) => a.action === "admin.job_retried")).toBe(true);
    });
  });
});

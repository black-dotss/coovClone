import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestError, ConflictError } from "@/lib/shared/errors";
import {
  paymentOrders,
  paymentVerifications,
  subscriptions,
  plans,
} from "@/lib/db/schema";
import {
  submitPaymentVerification,
  reconcileVerificationCompleted,
  resolveAmbiguousPaymentOrder,
} from "@/lib/payments/service";
import { VerifyEtClient } from "@/lib/payments/verify-et-client";

const mockOrder = {
  id: "ord-test-1",
  userId: "user-buyer-1",
  planId: "pro_monthly",
  amountEtb: 100,
  currency: "ETB",
  orderReference: "ORD-20261116-TEST01",
  expectedReceiver: "Telebirr (0911223344)",
  status: "pending",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // active
  createdAt: new Date(),
  updatedAt: new Date(),
};

let currentOrderState = { ...mockOrder };
let inMemoryVerifications: Record<string, unknown>[] = [];
let inMemorySubscriptions: Record<string, unknown>[] = [];

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => Promise.resolve(data.slice(0, n)),
    orderBy: () => createMockQuery(data),
    where: () => createMockQuery(data),
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === paymentOrders) return createMockQuery([currentOrderState]);
        if (table === paymentVerifications) return createMockQuery(inMemoryVerifications);
        if (table === subscriptions) return createMockQuery(inMemorySubscriptions);
        if (table === plans) return createMockQuery([{ id: "pro_monthly", priceEtb: 100 }]);
        return createMockQuery([]);
      },
    }),
    insert: (table: unknown) => ({
      values: (val: Record<string, unknown>) => {
        const record = { id: `id-${Date.now()}`, ...val, createdAt: new Date() };
        if (table === paymentVerifications) {
          inMemoryVerifications.push(record);
        }
        if (table === subscriptions) {
          inMemorySubscriptions.push(record);
        }
        return {
          returning: () => [record],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          if (table === paymentOrders) {
            Object.assign(currentOrderState, updates);
          }
          if (table === subscriptions && inMemorySubscriptions.length > 0) {
            Object.assign(inMemorySubscriptions[0], updates);
          }
          return Promise.resolve();
        },
      }),
    }),
  },
  paymentOrders: {},
  paymentVerifications: {},
  subscriptions: {},
  plans: {},
}));

describe("Payment Reconciliation and Subscription Activation", () => {
  beforeEach(() => {
    currentOrderState = {
      ...mockOrder,
      status: "pending",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
    inMemoryVerifications = [];
    inMemorySubscriptions = [];
    vi.clearAllMocks();
  });

  describe("Verified Payment & Subscription Activation", () => {
    it("activates Pro Monthly subscription in database when payment is verified", async () => {
      const mockClient = new VerifyEtClient();
      mockClient.setMockHandler(async () => ({
        status: "verified",
        requestId: "req-success-1",
        transactionReference: "TX-VALID-100",
        amount: 100,
        currency: "ETB",
        receiver: "Esrael Ashenafi",
      }));

      const res = await submitPaymentVerification(
        "user-buyer-1",
        {
          orderId: "ord-test-1",
          transactionReference: "TX-VALID-100",
          provider: "telebirr",
        },
        mockClient
      );

      expect(res.status).toBe("verified");
      expect(currentOrderState.status).toBe("verified");

      // Verify subscription created
      expect(inMemorySubscriptions).toHaveLength(1);
      expect(inMemorySubscriptions[0].status).toBe("active");
      expect(inMemorySubscriptions[0].planId).toBe("pro_monthly");
    });

    it("extends existing active subscription instead of overwriting", async () => {
      const existingEndDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days left
      inMemorySubscriptions.push({
        id: "sub-existing",
        userId: "user-buyer-1",
        planId: "pro_monthly",
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: existingEndDate,
      });

      const mockClient = new VerifyEtClient();
      mockClient.setMockHandler(async () => ({
        status: "verified",
        requestId: "req-extend-1",
        transactionReference: "TX-EXTEND-100",
        amount: 100,
        currency: "ETB",
        receiver: "Esrael Ashenafi",
      }));

      await submitPaymentVerification(
        "user-buyer-1",
        {
          orderId: "ord-test-1",
          transactionReference: "TX-EXTEND-100",
          provider: "telebirr",
        },
        mockClient
      );

      // Verify subscription was extended by 30 days past the existing end date
      const updatedSub = inMemorySubscriptions[0];
      const expectedEndMs = existingEndDate.getTime() + 30 * 24 * 60 * 60 * 1000;
      expect(new Date(updatedSub.currentPeriodEnd as Date).getTime()).toBeCloseTo(expectedEndMs, -3);
    });
    it("rejects payment if receiver is not Esrael Ashenafi", async () => {
      const mockClient = new VerifyEtClient();
      mockClient.setMockHandler(async () => ({
        status: "verified",
        requestId: "req-unauthorized-rx",
        transactionReference: "TX-WRONG-RX-1",
        amount: 100,
        currency: "ETB",
        receiver: "John Doe Unauthorized Person",
        receiverAccount: "1000999999999",
      }));

      const res = await submitPaymentVerification(
        "user-buyer-1",
        {
          orderId: "ord-test-1",
          transactionReference: "TX-WRONG-RX-1",
          provider: "telebirr",
        },
        mockClient
      );

      expect(res.status).toBe("failed");
      expect(currentOrderState.status).toBe("failed");
      expect(res.message).toContain("Esrael Ashenafi");
      expect(inMemorySubscriptions).toHaveLength(0); // Pro access NOT activated
    });
  });

  describe("Transaction Reference Reuse Prevention", () => {
    it("rejects duplicate transaction reference if already verified for another payment", async () => {
      // Record a pre-existing verified transaction
      inMemoryVerifications.push({
        id: "ver-old",
        orderId: "ord-previous-other",
        transactionReference: "TX-ALREADY-USED",
        status: "verified",
        verifiedAmount: 100,
      });

      await expect(
        submitPaymentVerification("user-buyer-1", {
          orderId: "ord-test-1",
          transactionReference: "TX-ALREADY-USED",
          provider: "telebirr",
        })
      ).rejects.toThrow(ConflictError);

      expect(currentOrderState.status).toBe("duplicate");
      expect(inMemorySubscriptions).toHaveLength(0); // Pro access NOT activated
    });
  });

  describe("Underpayment & Ambiguous Handling", () => {
    it("flags underpaid transactions as ambiguous without activating subscription", async () => {
      const mockClient = new VerifyEtClient();
      mockClient.setMockHandler(async () => ({
        status: "verified",
        requestId: "req-underpaid",
        transactionReference: "TX-SHORT-50",
        amount: 50, // Paid 50 ETB instead of required 100 ETB
        currency: "ETB",
        receiver: "Esrael Ashenafi",
      }));

      const res = await submitPaymentVerification(
        "user-buyer-1",
        {
          orderId: "ord-test-1",
          transactionReference: "TX-SHORT-50",
          provider: "telebirr",
        },
        mockClient
      );

      expect(res.status).toBe("ambiguous");
      expect(currentOrderState.status).toBe("ambiguous");
      expect(inMemorySubscriptions).toHaveLength(0); // Pro access NOT activated
    });

    it("activates subscription when payment is greater than subscription price and advises contacting admin", async () => {
      const mockClient = new VerifyEtClient();
      mockClient.setMockHandler(async () => ({
        status: "verified",
        requestId: "req-overpaid",
        transactionReference: "TX-OVERPAID-340",
        amount: 340, // Paid 340 ETB for 100 ETB plan
        currency: "ETB",
        receiver: "Esrael Ashenafi",
      }));

      const res = await submitPaymentVerification(
        "user-buyer-1",
        {
          orderId: "ord-test-1",
          transactionReference: "TX-OVERPAID-340",
          provider: "cbe",
        },
        mockClient
      );

      expect(res.status).toBe("verified");
      expect(currentOrderState.status).toBe("verified");
      expect(inMemorySubscriptions).toHaveLength(1); // Pro access ACTIVATED
      expect(res.message).toContain("greater than the subscription price");
      expect(res.message).toContain("contact the admin");
    });

    it("allows admin to review and approve ambiguous payments", async () => {
      currentOrderState.status = "ambiguous";

      const resolved = await resolveAmbiguousPaymentOrder(
        "ord-test-1",
        "admin-user-001",
        "approve",
        "Customer provided bank receipt proof manually"
      );

      expect(resolved.status).toBe("verified");
      expect(inMemorySubscriptions).toHaveLength(1);
    });
  });

  describe("Expiry and Idempotent Webhook Handling", () => {
    it("rejects verification on expired payment orders", async () => {
      currentOrderState.expiresAt = new Date(Date.now() - 3600_000); // 1 hour ago

      await expect(
        submitPaymentVerification("user-buyer-1", {
          orderId: "ord-test-1",
          transactionReference: "TX-LATE",
          provider: "telebirr",
        })
      ).rejects.toThrow(BadRequestError);

      expect(currentOrderState.status).toBe("expired");
    });

    it("handles duplicate webhook callbacks idempotently without double-activating", async () => {
      // First webhook arrives
      const outcome1 = await reconcileVerificationCompleted({
        event: "verification.completed",
        requestId: "req-webhook-idemp",
        transactionReference: "TX-IDEMP-100",
        status: "verified",
        amount: 100,
        currency: "ETB",
        timestamp: new Date().toISOString(),
      });

      expect(outcome1.status).toBe("verified");
      expect(inMemorySubscriptions).toHaveLength(1);

      // Second identical webhook arrives
      const outcome2 = await reconcileVerificationCompleted({
        event: "verification.completed",
        requestId: "req-webhook-idemp",
        transactionReference: "TX-IDEMP-100",
        status: "verified",
        amount: 100,
        currency: "ETB",
        timestamp: new Date().toISOString(),
      });

      expect(outcome2.status).toBe("already_verified");
      expect(inMemorySubscriptions).toHaveLength(1); // Not duplicated
    });
  });
});

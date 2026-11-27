import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, NotFoundError } from "@/lib/shared/errors";
import { paymentOrders, plans } from "@/lib/db/schema";
import {
  createPaymentOrder,
  getPaymentOrder,
  listPaymentOrders,
  generateOrderReference,
} from "@/lib/payments/service";
import { SUPPORTED_RECEIVING_ACCOUNTS } from "@/lib/payments/config";

const mockMonthlyPlan = {
  id: "pro_monthly",
  name: "Pro Monthly",
  tier: "pro_monthly",
  priceEtb: 150,
};

const mockYearlyPlan = {
  id: "pro_yearly",
  name: "Pro Yearly",
  tier: "pro_yearly",
  priceEtb: 1000,
};

let inMemoryOrders: Record<string, unknown>[] = [];

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
        if (table === plans) return createMockQuery([mockMonthlyPlan, mockYearlyPlan]);
        if (table === paymentOrders) return createMockQuery(inMemoryOrders);
        return createMockQuery([]);
      },
    }),
    insert: () => ({
      values: (val: Record<string, unknown>) => {
        const record = { id: `ord-${Date.now()}`, ...val, createdAt: new Date(), updatedAt: new Date() };
        inMemoryOrders.push(record);
        return {
          returning: () => [record],
        };
      },
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          if (inMemoryOrders.length > 0) {
            Object.assign(inMemoryOrders[0], updates);
          }
          return Promise.resolve();
        },
      }),
    }),
  },
  plans: {},
  paymentOrders: {},
  paymentVerifications: {},
  subscriptions: {},
}));

describe("Payment Orders and Pricing Enforcement", () => {
  beforeEach(() => {
    inMemoryOrders = [];
    vi.clearAllMocks();
  });

  describe("Order Reference & Expiry Formatting", () => {
    it("generates a standardized order reference with ORD- prefix and date", () => {
      const ref = generateOrderReference();
      expect(ref).toMatch(/^ORD-\d{8}-[A-F0-9]{6}$/);
    });

    it("creates unique order references on successive invocations", () => {
      const ref1 = generateOrderReference();
      const ref2 = generateOrderReference();
      expect(ref1).not.toBe(ref2);
    });
  });

  describe("Server-Side Price Control & Configuration", () => {
    it("enforces fixed server-side price of 150 ETB for pro_monthly plan", async () => {
      const order = await createPaymentOrder("user-1", {
        planTier: "pro_monthly",
        preferredProvider: "telebirr",
      });

      expect(order.amountEtb).toBe(150);
      expect(order.currency).toBe("ETB");
      expect(order.planTier).toBe("pro_monthly");
      expect(order.status).toBe("pending");
      expect(order.expectedReceiver).toContain(SUPPORTED_RECEIVING_ACCOUNTS.telebirr.accountNumber);

      // Verify 24-hour expiry window
      const now = Date.now();
      const expiryMs = new Date(order.expiresAt).getTime();
      expect(expiryMs - now).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(expiryMs - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5000);
    });

    it("enforces fixed server-side price of 1,000 ETB for pro_yearly plan", async () => {
      const order = await createPaymentOrder("user-1", {
        planTier: "pro_yearly",
        preferredProvider: "cbe",
      });

      expect(order.amountEtb).toBe(1000);
      expect(order.currency).toBe("ETB");
      expect(order.expectedReceiver).toContain(SUPPORTED_RECEIVING_ACCOUNTS.cbe.accountNumber);
    });

    it("provides payment instructions for all supported Ethiopian receiving accounts", async () => {
      const order = await createPaymentOrder("user-1", { planTier: "pro_monthly" });

      expect(order.receivingAccounts).toHaveLength(4);
      const providers = order.receivingAccounts.map((a) => a.provider);
      expect(providers).toContain("telebirr");
      expect(providers).toContain("cbe");
      expect(providers).toContain("awash");
      expect(providers).toContain("boa");
    });
  });

  describe("Order Retrieval & Ownership", () => {
    it("retrieves payment order details when caller owns the order", async () => {
      const created = await createPaymentOrder("user-owner-1", { planTier: "pro_monthly" });
      const fetched = await getPaymentOrder(created.id, "user-owner-1");

      expect(fetched.id).toBe(created.id);
      expect(fetched.amountEtb).toBe(150);
      expect(fetched.orderReference).toBe(created.orderReference);
    });

    it("rejects unauthorized users with ForbiddenError", async () => {
      const created = await createPaymentOrder("user-owner-1", { planTier: "pro_monthly" });

      await expect(
        getPaymentOrder(created.id, "attacker-user-999")
      ).rejects.toThrow(ForbiddenError);
    });

    it("throws NotFoundError when order does not exist", async () => {
      const { db } = await import("@/lib/db");
      vi.spyOn(db, "select").mockReturnValueOnce({
        from: () => createMockQuery([]),
      } as unknown as ReturnType<typeof db.select>);

      await expect(
        getPaymentOrder("non-existent-order-id", "user-owner-1")
      ).rejects.toThrow(NotFoundError);
    });

    it("lists all orders belonging to the user", async () => {
      await createPaymentOrder("user-owner-1", { planTier: "pro_monthly" });
      await createPaymentOrder("user-owner-1", { planTier: "pro_yearly" });

      const orders = await listPaymentOrders("user-owner-1");
      expect(orders.length).toBeGreaterThanOrEqual(2);
    });
  });
});

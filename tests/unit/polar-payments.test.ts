import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnauthorizedError } from "@/lib/shared/errors";
import { POST as checkoutHandler } from "@/app/api/payments/polar/checkout/route";
import { GET as webhookGetHandler, POST as webhookPostHandler } from "@/app/api/webhooks/polar/route";
import * as authSession from "@/lib/auth/session";
import * as polarWebhooks from "@/lib/payments/polar-webhooks";
import * as billingSubs from "@/lib/billing/subscriptions";

// Mock auth session
vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
}));

// Mock Polar SDK webhooks
type MockValidatedEvent = Awaited<ReturnType<typeof polarWebhooks.validateEvent>>;
vi.mock("@/lib/payments/polar-webhooks", () => ({
  validateEvent: vi.fn(),
  PolarWebhookVerificationError: class PolarWebhookVerificationError extends Error {},
}));

// Mock billing subscriptions
vi.mock("@/lib/billing/subscriptions", () => ({
  upgradeUserSubscriptionTier: vi.fn(),
  revertUserToFreeTier: vi.fn(),
}));

// Mock polar client
const { mockCheckoutsCreate, mockCustomerSessionsCreate } = vi.hoisted(() => ({
  mockCheckoutsCreate: vi.fn(),
  mockCustomerSessionsCreate: vi.fn(),
}));

vi.mock("@/lib/payments/polar-client", () => {
  const polarClient = {
    checkouts: {
      create: mockCheckoutsCreate,
    },
    customerSessions: {
      create: mockCustomerSessionsCreate,
    },
    customers: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      create: vi.fn().mockResolvedValue({ id: "cust_mock_1" }),
    },
  };
  return {
    getPolarClient: () => polarClient,
    executePolarCall: async (fn: (p: typeof polarClient) => Promise<unknown>) => fn(polarClient),
    getPolarProductIdForTier: (tier: string) => {
      if (tier === "pro_plus_monthly") return "prod_pro_plus_monthly";
      if (tier === "pro_plus_yearly") return "prod_pro_plus_yearly";
      if (tier === "executive_unlimited" || tier === "unlimited_yearly") return "prod_executive_unlimited";
      return "prod_pro_monthly";
    },
  };
});

describe("Polar.sh Payments & Webhooks Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.POLAR_ACCESS_TOKEN = "polar_at_mock_token";
    process.env.POLAR_WEBHOOK_SECRET = "whsec_mock_secret_123";
    process.env.POLAR_PRODUCT_ID_PRO_MONTHLY = "prod_pro_monthly";
    process.env.POLAR_PRODUCT_ID_PRO_PLUS_MONTHLY = "prod_pro_plus_monthly";
    process.env.POLAR_PRODUCT_ID_PRO_PLUS_YEARLY = "prod_pro_plus_yearly";
    process.env.POLAR_PRODUCT_ID_EXECUTIVE_UNLIMITED = "prod_executive_unlimited";
  });

  describe("Checkout Route (/api/payments/polar/checkout)", () => {
    it("creates a checkout session with user id in customerExternalId and metadata", async () => {
      vi.mocked(authSession.requireAuth).mockResolvedValue({
        user: { id: "user_test_123", email: "user@example.com", name: "Test User" },
        sessionToken: "mock_token_123",
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      mockCheckoutsCreate.mockResolvedValue({
        id: "chk_123",
        url: "https://polar.sh/checkout/chk_123",
      });

      const req = new Request("http://localhost:3000/api/payments/polar/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTier: "pro_plus_monthly" }),
      });

      const res = await checkoutHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.checkoutUrl).toBe("https://polar.sh/checkout/chk_123");

      expect(mockCheckoutsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          products: ["prod_pro_plus_monthly"],
          external_customer_id: "user_test_123",
          customerExternalId: "user_test_123",
          metadata: {
            userId: "user_test_123",
            planTier: "pro_plus_monthly",
          },
        })
      );
    });

    it("returns 401 when user is not authenticated", async () => {
      vi.mocked(authSession.requireAuth).mockRejectedValue(
        new UnauthorizedError("Authentication required")
      );

      const req = new Request("http://localhost:3000/api/payments/polar/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTier: "pro_monthly" }),
      });

      const res = await checkoutHandler(req);
      expect(res.status).toBe(401);
    });
  });

  describe("Webhook Route (/api/webhooks/polar)", () => {
    it("responds 200 to GET status request", async () => {
      const res = await webhookGetHandler();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe("active");
      expect(json.data.provider).toBe("Polar.sh");
    });

    it("returns 403 when signature verification fails", async () => {
      vi.mocked(polarWebhooks.validateEvent).mockRejectedValue(
        new polarWebhooks.PolarWebhookVerificationError("Invalid signature")
      );

      const req = new Request("http://localhost:3000/api/webhooks/polar", {
        method: "POST",
        headers: {
          "webhook-id": "msg_123",
          "webhook-timestamp": "12345678",
          "webhook-signature": "v1,invalid",
        },
        body: JSON.stringify({ type: "order.paid" }),
      });

      const res = await webhookPostHandler(req);
      expect(res.status).toBe(403);
    });

    it("handles order.paid and upgrades user tier idempotently", async () => {
      vi.mocked(polarWebhooks.validateEvent).mockResolvedValue({
        type: "order.paid",
        data: {
          id: "ord_123",
          customer: {
            external_id: "user_polar_abc",
          },
          product: {
            metadata: {
              plan_tier: "pro_plus_monthly",
            },
          },
          current_period_start: "2026-11-18T00:00:00.000Z",
          current_period_end: "2026-12-18T00:00:00.000Z",
        },
      } as unknown as MockValidatedEvent);

      const req = new Request("http://localhost:3000/api/webhooks/polar", {
        method: "POST",
        headers: {
          "webhook-id": "msg_123",
          "webhook-timestamp": "12345678",
          "webhook-signature": "v1,valid",
        },
        body: JSON.stringify({ type: "order.paid" }),
      });

      const res = await webhookPostHandler(req);
      expect(res.status).toBe(200);

      expect(billingSubs.upgradeUserSubscriptionTier).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_polar_abc",
          planTier: "pro_plus_monthly",
          periodStart: new Date("2026-11-18T00:00:00.000Z"),
          periodEnd: new Date("2026-12-18T00:00:00.000Z"),
        })
      );
    });

    it("handles subscription.active with metadata fallback", async () => {
      vi.mocked(polarWebhooks.validateEvent).mockResolvedValue({
        type: "subscription.active",
        data: {
          id: "sub_123",
          metadata: {
            userId: "user_from_meta",
          },
          product: {
            metadata: {
              plan_tier: "executive_unlimited",
            },
          },
        },
      } as unknown as MockValidatedEvent);

      const req = new Request("http://localhost:3000/api/webhooks/polar", {
        method: "POST",
        headers: {
          "webhook-id": "msg_124",
          "webhook-timestamp": "12345679",
          "webhook-signature": "v1,valid",
        },
        body: JSON.stringify({ type: "subscription.active" }),
      });

      const res = await webhookPostHandler(req);
      expect(res.status).toBe(200);

      expect(billingSubs.upgradeUserSubscriptionTier).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_from_meta",
          planTier: "unlimited_yearly",
        })
      );
    });

    it("handles subscription.revoked and reverts user to free tier", async () => {
      vi.mocked(polarWebhooks.validateEvent).mockResolvedValue({
        type: "subscription.revoked",
        data: {
          id: "sub_123",
          customer: {
            externalId: "user_to_revert",
          },
        },
      } as unknown as MockValidatedEvent);

      const req = new Request("http://localhost:3000/api/webhooks/polar", {
        method: "POST",
        headers: {
          "webhook-id": "msg_125",
          "webhook-timestamp": "12345680",
          "webhook-signature": "v1,valid",
        },
        body: JSON.stringify({ type: "subscription.revoked" }),
      });

      const res = await webhookPostHandler(req);
      expect(res.status).toBe(200);

      expect(billingSubs.revertUserToFreeTier).toHaveBeenCalledWith("user_to_revert");
    });

    it("handles order.created when status is paid and upgrades user tier", async () => {
      vi.mocked(polarWebhooks.validateEvent).mockResolvedValue({
        type: "order.created",
        data: {
          id: "ord_paid_created_123",
          status: "paid",
          paid: true,
          customer: {
            external_id: "8fd16600-a59c-444f-bd7a-5769b1a318d0",
          },
          metadata: {
            userId: "8fd16600-a59c-444f-bd7a-5769b1a318d0",
            planTier: "pro_monthly",
          },
          product: {
            name: "Coov monthly pro",
          },
        },
      } as unknown as MockValidatedEvent);

      const req = new Request("http://localhost:3000/api/webhooks/polar", {
        method: "POST",
        headers: {
          "webhook-id": "msg_order_created_1",
          "webhook-timestamp": "12345682",
          "webhook-signature": "v1,valid",
        },
        body: JSON.stringify({ type: "order.created" }),
      });

      const res = await webhookPostHandler(req);
      expect(res.status).toBe(200);

      expect(billingSubs.upgradeUserSubscriptionTier).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "8fd16600-a59c-444f-bd7a-5769b1a318d0",
          planTier: "pro_monthly",
        })
      );
    });

    it("acknowledges non-tier webhook events with 200 without error", async () => {
      vi.mocked(polarWebhooks.validateEvent).mockResolvedValue({
        type: "checkout.updated",
        data: { id: "chk_upd" },
      } as unknown as MockValidatedEvent);

      const req = new Request("http://localhost:3000/api/webhooks/polar", {
        method: "POST",
        headers: {
          "webhook-id": "msg_chk_1",
          "webhook-timestamp": "12345683",
          "webhook-signature": "v1,valid",
        },
        body: JSON.stringify({ type: "checkout.updated" }),
      });

      const res = await webhookPostHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
    });

    it("supports the alternate /polar-sh/sdk/webhooks endpoint", async () => {
      const { GET: altGet, POST: altPost } = await import("@/app/polar-sh/sdk/webhooks/route");
      const getRes = await altGet();
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json();
      expect(getJson.status).toBe("active");
      expect(getJson.endpoint).toBe("/polar-sh/sdk/webhooks");

      vi.mocked(polarWebhooks.validateEvent).mockResolvedValue({
        type: "order.paid",
        data: {
          customer: { externalId: "user_alt_test" },
          product: { metadata: { plan_tier: "pro_monthly" } },
        },
      } as unknown as MockValidatedEvent);

      const postReq = new Request("https://coov.byisrael.tech/polar-sh/sdk/webhooks", {
        method: "POST",
        headers: {
          "webhook-id": "msg_alt_1",
          "webhook-timestamp": "12345681",
          "webhook-signature": "v1,valid",
        },
        body: JSON.stringify({ type: "order.paid" }),
      });

      const postRes = await altPost(postReq);
      expect(postRes.status).toBe(200);
      expect(billingSubs.upgradeUserSubscriptionTier).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_alt_test",
          planTier: "pro_monthly",
        })
      );
    });
  });

  describe("Customer Portal Route (/api/payments/polar/portal)", () => {
    it("creates a customer portal session for authenticated user", async () => {
      const { POST: portalHandler } = await import("@/app/api/payments/polar/portal/route");

      vi.mocked(authSession.requireAuth).mockResolvedValue({
        user: { id: "user_portal_test", email: "portal@example.com", name: "Portal User" },
        sessionToken: "mock_portal_token",
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      mockCustomerSessionsCreate.mockResolvedValue({
        customer_portal_url: "https://sandbox.polar.sh/portal/sess_123",
      });

      const req = new Request("http://localhost:3000/api/payments/polar/portal", {
        method: "POST",
      });

      const res = await portalHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.portalUrl).toBe("https://sandbox.polar.sh/portal/sess_123");
      expect(mockCustomerSessionsCreate).toHaveBeenCalledWith({
        external_customer_id: "user_portal_test",
      });
    });
  });
});

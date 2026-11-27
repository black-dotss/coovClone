import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeWebhookSignature,
  verifyWebhookSignature,
  handleVerifyEtWebhook,
} from "@/lib/payments/webhook";
import { VerifyEtPaymentWebhookSchema } from "@/lib/payments/validation";
import { POST as webhookPostHandler } from "@/app/api/webhooks/verify-et/route";
import { getEnv } from "@/lib/env";
import { UnauthorizedError, BadRequestError } from "@/lib/shared/errors";

const MOCK_SECRET = "test-webhook-secret-key-123456789";

describe("Verify.ET Signed Webhook Verification & Security", () => {
  const samplePayload = JSON.stringify({
    event: "verification.completed",
    requestId: "req-webhook-1",
    transactionReference: "TX-WEBHOOK-123",
    status: "verified",
    amount: 100,
    currency: "ETB",
    timestamp: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("HMAC-SHA256 Signature Verification", () => {
    it("successfully verifies valid HMAC-SHA256 signature over raw body and timestamp", () => {
      const timestamp = String(Date.now());
      const signature = computeWebhookSignature(samplePayload, timestamp, MOCK_SECRET);

      const isValid = verifyWebhookSignature(samplePayload, signature, timestamp, MOCK_SECRET);
      expect(isValid).toBe(true);
    });

    it("successfully verifies signature with sha256= prefix", () => {
      const timestamp = String(Date.now());
      const rawSig = computeWebhookSignature(samplePayload, timestamp, MOCK_SECRET);
      const signatureWithPrefix = `sha256=${rawSig}`;

      const isValid = verifyWebhookSignature(samplePayload, signatureWithPrefix, timestamp, MOCK_SECRET);
      expect(isValid).toBe(true);
    });

    it("successfully verifies signature during secret rotation with multiple sha256= hashes", () => {
      const timestamp = String(Date.now());
      const rawSig = computeWebhookSignature(samplePayload, timestamp, MOCK_SECRET);
      const rotationHeader = `sha256=0000000000000000000000000000000000000000000000000000000000000000, sha256=${rawSig}`;

      const isValid = verifyWebhookSignature(samplePayload, rotationHeader, timestamp, MOCK_SECRET);
      expect(isValid).toBe(true);
    });

    it("successfully verifies signature when secret has whsec_ prefix", () => {
      const whsecSecret = "whsec_customSecretKeyForVerifyEt12345";
      const timestamp = String(Date.now());
      const rawSig = computeWebhookSignature(samplePayload, timestamp, whsecSecret);
      const signature = `sha256=${rawSig}`;

      const isValid = verifyWebhookSignature(samplePayload, signature, timestamp, whsecSecret);
      expect(isValid).toBe(true);
    });

    it("successfully verifies signature when timestamp is an ISO-8601 string", () => {
      const isoTimestamp = new Date().toISOString();
      const rawSig = computeWebhookSignature(samplePayload, isoTimestamp, MOCK_SECRET);

      const isValid = verifyWebhookSignature(samplePayload, rawSig, isoTimestamp, MOCK_SECRET);
      expect(isValid).toBe(true);
    });

    it("rejects when the request body has been altered or tampered with", () => {
      const timestamp = String(Date.now());
      const signature = computeWebhookSignature(samplePayload, timestamp, MOCK_SECRET);

      const tamperedBody = samplePayload.replace('"amount":100', '"amount":1000');
      const isValid = verifyWebhookSignature(tamperedBody, signature, timestamp, MOCK_SECRET);
      expect(isValid).toBe(false);
    });

    it("rejects when an incorrect secret key is used", () => {
      const timestamp = String(Date.now());
      const signature = computeWebhookSignature(samplePayload, timestamp, "wrong-secret");

      const isValid = verifyWebhookSignature(samplePayload, signature, timestamp, MOCK_SECRET);
      expect(isValid).toBe(false);
    });
  });

  describe("Replay Attack Protection", () => {
    it("rejects webhook events with timestamps older than 5 minutes", () => {
      // 10 minutes ago
      const expiredTimestamp = String(Date.now() - 10 * 60 * 1000);
      const signature = computeWebhookSignature(samplePayload, expiredTimestamp, MOCK_SECRET);

      const isValid = verifyWebhookSignature(samplePayload, signature, expiredTimestamp, MOCK_SECRET);
      expect(isValid).toBe(false);
    });

    it("rejects webhook events with malformed or invalid timestamp header", () => {
      const signature = "some-sig";
      const isValid = verifyWebhookSignature(samplePayload, signature, "not-a-number", MOCK_SECRET);
      expect(isValid).toBe(false);
    });

    it("rejects when signature is missing", () => {
      expect(verifyWebhookSignature(samplePayload, null, "123456", MOCK_SECRET)).toBe(false);
    });
  });

  describe("Webhook Handler Integration", () => {
    it("throws UnauthorizedError when signature validation fails", async () => {
      await expect(
        handleVerifyEtWebhook(samplePayload, "invalid-sig", String(Date.now()))
      ).rejects.toThrow(UnauthorizedError);
    });

    it("throws BadRequestError when payload contains invalid JSON", async () => {
      const timestamp = String(Date.now());
      const invalidJson = "{ malformed json ";
      const sig = computeWebhookSignature(invalidJson, timestamp, MOCK_SECRET);

      await expect(
        handleVerifyEtWebhook(invalidJson, sig, timestamp, MOCK_SECRET)
      ).rejects.toThrow(BadRequestError);
    });

    it("successfully acknowledges authenticated ping and test events without failing schema validation", async () => {
      const timestamp = String(Date.now());
      const pingPayload = JSON.stringify({
        event: "ping",
        message: "Verify.ET connectivity test",
        timestamp: new Date().toISOString(),
      });
      const sig = computeWebhookSignature(pingPayload, timestamp, MOCK_SECRET);

      const outcome = await handleVerifyEtWebhook(pingPayload, sig, timestamp, MOCK_SECRET);
      expect(outcome.status).toBe("verified");
      expect(outcome.event).toBe("ping");
      expect(outcome.message).toContain("acknowledged");
    });

    it("successfully acknowledges authenticated test event with type='test'", async () => {
      const timestamp = String(Date.now());
      const testPayload = JSON.stringify({
        type: "test",
        ping: true,
      });
      const sig = computeWebhookSignature(testPayload, timestamp, MOCK_SECRET);

      const outcome = await handleVerifyEtWebhook(testPayload, sig, timestamp, MOCK_SECRET);
      expect(outcome.status).toBe("verified");
      expect(outcome.event).toBe("test");
    });

    it("successfully parses official Verify.ET nested payment completed event", () => {
      const nestedPayload = {
        id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        event: "verification.completed",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        timestamp: "2026-02-20T12:00:02.500Z",
        data: {
          processingStatus: "completed",
          status: "success",
          verified: true,
          bank: "cbe",
          amount: "1500",
          currency: "ETB",
          senderName: "Abebe Bikila",
          receiverName: "Acme Trading",
          referenceNumber: "FT26EXAMPLE1",
          receiptNumber: "fHCxyExampleRcpt1",
          durationMs: 2340,
          completedAt: "2026-02-20T12:00:02.340Z",
        },
      };

      const parsed = VerifyEtPaymentWebhookSchema.safeParse(nestedPayload);
      expect(parsed.success).toBe(true);
    });

    it("successfully acknowledges official Verify.ET webhook.test event", async () => {
      const timestamp = String(Date.now());
      const testPayload = JSON.stringify({
        id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        event: "webhook.test",
        timestamp: new Date().toISOString(),
      });
      const sig = `sha256=${computeWebhookSignature(testPayload, timestamp, MOCK_SECRET)}`;

      const outcome = await handleVerifyEtWebhook(testPayload, sig, timestamp, MOCK_SECRET);
      expect(outcome.status).toBe("verified");
      expect(outcome.event).toBe("webhook.test");
    });
  });

  describe("Verify.ET Route Handler", () => {
    it("replies 204 No Content when X-Webhook-Test: true header is present", async () => {
      const req = new Request("http://localhost:3000/api/webhooks/verify-et", {
        method: "POST",
        headers: {
          "x-webhook-test": "true",
          "content-type": "application/json",
        },
        body: JSON.stringify({ event: "webhook.test" }),
      });

      const res = await webhookPostHandler(req);
      expect(res.status).toBe(204);
    });

    it("replies 204 No Content for authenticated test webhook with X-Webhook-Signature", async () => {
      const timestamp = String(Date.now());
      const payload = JSON.stringify({ event: "webhook.test" });
      const envSecret = getEnv().VERIFY_ET_WEBHOOK_SECRET ?? "ci-test-mock-verify-webhook-secret-key-123456";
      const sig = `sha256=${computeWebhookSignature(payload, timestamp, envSecret)}`;

      const req = new Request("http://localhost:3000/api/webhooks/verify-et", {
        method: "POST",
        headers: {
          "x-webhook-signature": sig,
          "x-webhook-timestamp": timestamp,
          "content-type": "application/json",
        },
        body: payload,
      });

      const res = await webhookPostHandler(req);
      expect(res.status).toBe(204);
    });
  });
});

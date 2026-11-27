import { describe, it, expect, vi, beforeEach } from "vitest";
import { VerifyEtClient } from "@/lib/payments/verify-et-client";
import { AppError } from "@/lib/shared/errors";

describe("Verify.ET API Client", () => {
  let client: VerifyEtClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new VerifyEtClient({
      apiKey: "test-api-key-12345",
      baseUrl: "https://verify.et/api",
      timeoutMs: 1000,
      maxRetries: 1,
    });
  });

  describe("Idempotency & Request Headers", () => {
    it("includes x-api-key and unique Idempotency-Key header on outgoing requests", async () => {
      let capturedHeaders: Record<string, string> = {};

      const fetchMock = vi.fn().mockImplementation((url, init) => {
        capturedHeaders = init.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              status: "verified",
              request_id: "req-123",
              amount: 100,
              currency: "ETB",
            }),
        });
      });

      global.fetch = fetchMock;

      const res = await client.verifyTransaction(
        {
          transactionReference: "TX-123456",
          provider: "telebirr",
          expectedAmount: 100,
        },
        "idemp-key-custom-999"
      );

      expect(res.status).toBe("verified");
      expect(capturedHeaders["x-api-key"]).toBe("test-api-key-12345");
      expect(capturedHeaders["Idempotency-Key"]).toBe("idemp-key-custom-999");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Response Code Handling (200 OK vs 202 Accepted)", () => {
    it("treats HTTP 202 as pending and returns requestId for async webhook completion", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 202,
        json: () =>
          Promise.resolve({
            status: "pending",
            request_id: "req-async-777",
          }),
      });

      const res = await client.verifyTransaction({
        transactionReference: "TX-PENDING-123",
        provider: "cbe",
        expectedAmount: 1000,
      });

      expect(res.status).toBe("pending");
      expect(res.requestId).toBe("req-async-777");
      expect(res.amount).toBe(1000);
    });

    it("treats HTTP 200 as immediate verification", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            status: "verified",
            request_id: "req-instant-888",
            amount: 100,
            currency: "ETB",
            receiver: "CookMyCv Tech",
            verified_at: "2026-11-16T19:00:00Z",
          }),
      });

      const res = await client.verifyTransaction({
        transactionReference: "TX-VERIFIED-456",
        provider: "telebirr",
        expectedAmount: 100,
      });

      expect(res.status).toBe("verified");
      expect(res.amount).toBe(100);
      expect(res.receiver).toBe("CookMyCv Tech");
    });
  });

  describe("Retries and Timeout Handling", () => {
    it("retries on transient 500/503 errors and succeeds if next attempt succeeds", async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
            text: () => Promise.resolve("Service Unavailable"),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              status: "verified",
              request_id: "req-retry-success",
              amount: 100,
            }),
        });
      });

      const res = await client.verifyTransaction({
        transactionReference: "TX-RETRY-TEST",
        provider: "awash",
        expectedAmount: 100,
      });

      expect(res.status).toBe("verified");
      expect(callCount).toBe(2);
    });

    it("throws AppError when retries are exhausted", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve("Bad Gateway"),
      });

      await expect(
        client.verifyTransaction({
          transactionReference: "TX-FAIL",
          provider: "telebirr",
          expectedAmount: 100,
        })
      ).rejects.toThrow(AppError);
    });
  });
});

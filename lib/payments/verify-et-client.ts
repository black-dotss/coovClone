import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { VerifyEtVerifyRequest, VerifyEtVerifyResponse } from "./types";
import { AppError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

export interface VerifyEtClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  mockHandler?: (req: VerifyEtVerifyRequest) => Promise<VerifyEtVerifyResponse>;
}

/**
 * Client for the Verify.ET transaction verification API.
 * Encapsulates authentication, idempotency keys, timeout abortion, retries,
 * and deterministic mock handling for test and local development.
 */
export class VerifyEtClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private mockHandler?: (req: VerifyEtVerifyRequest) => Promise<VerifyEtVerifyResponse>;

  constructor(options?: VerifyEtClientOptions) {
    const env = getEnv();
    this.apiKey = options?.apiKey ?? env.VERIFY_ET_API_KEY ?? "development-verify-et-key";
    const rawBaseUrl = options?.baseUrl ?? env.VERIFY_ET_BASE_URL ?? "https://verify.et/api";
    this.baseUrl = rawBaseUrl.endsWith("/api") ? rawBaseUrl : `${rawBaseUrl.replace(/\/+$/, "")}/api`;
    this.timeoutMs = options?.timeoutMs ?? 10_000;
    this.maxRetries = options?.maxRetries ?? 2;
    this.mockHandler = options?.mockHandler;
  }

  setMockHandler(handler: (req: VerifyEtVerifyRequest) => Promise<VerifyEtVerifyResponse>): void {
    this.mockHandler = handler;
  }

  /**
   * Submits a transaction verification request to Verify.ET.
   */
  async verifyTransaction(
    request: VerifyEtVerifyRequest,
    idempotencyKey?: string
  ): Promise<VerifyEtVerifyResponse> {
    const key = idempotencyKey ?? randomUUID();

    // 1. If mock handler is set or in local/test development mode:
    if (this.mockHandler) {
      return this.mockHandler(request);
    }

    if (this.apiKey === "development-verify-et-key") {
      return this.defaultMockVerification(request);
    }

    // 2. Live HTTP request with retries and timeouts:
    let attempt = 0;
    while (attempt <= this.maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const bank = (request.bank || request.provider || "telebirr").toLowerCase();
        const rawRef = String(request.transactionReference || "").trim();
        const cbeUrlMatch = rawRef.match(/(?:https?:\/\/)?(?:mbreciept|receipt)\.cbe\.com\.et\/([^\s]+)/i);
        const cbeCodeMatch = rawRef.match(/\b(v2-[a-zA-Z0-9_-]+)\b/i);
        const ftMatch = rawRef.match(/\b(FT[0-9A-Za-z]{8,16})\b/i);

        const verifyPayload: Record<string, unknown> = {
          reference: rawRef,
          bank,
          amount: request.expectedAmount,
          expected_amount: request.expectedAmount,
          provider: bank,
        };

        if (bank === "cbe") {
          const acc = request.accountNumber || "1000596935234";
          verifyPayload.accountNumber = acc;
          verifyPayload.accountSuffix = acc.slice(-8);
          verifyPayload.suffix = acc.slice(-8);

          const receiptCode = cbeCodeMatch ? cbeCodeMatch[1] : (cbeUrlMatch ? cbeUrlMatch[1] : undefined);
          const fullReceiptUrl = cbeUrlMatch
            ? (cbeUrlMatch[0].startsWith("http") ? cbeUrlMatch[0] : `https://${cbeUrlMatch[0]}`)
            : (receiptCode ? `https://mbreciept.cbe.com.et/${receiptCode}` : undefined);

          if (receiptCode) {
            verifyPayload.receiptNumber = receiptCode;
            verifyPayload.reference = receiptCode;
          }
          if (fullReceiptUrl) {
            verifyPayload.receiptUrl = fullReceiptUrl;
            verifyPayload.receiptLink = fullReceiptUrl;
            verifyPayload.cbe_receipt_link = fullReceiptUrl;
            if (!verifyPayload.receiptNumber) {
              verifyPayload.receiptNumber = fullReceiptUrl;
            }
          }
          if (ftMatch) {
            verifyPayload.referenceNumber = ftMatch[1].toUpperCase();
            if (!verifyPayload.reference) {
              verifyPayload.reference = ftMatch[1].toUpperCase();
            }
          }
          if (!verifyPayload.receiptNumber && !verifyPayload.referenceNumber && !verifyPayload.receiptLink) {
            verifyPayload.receiptNumber = rawRef;
            verifyPayload.referenceNumber = rawRef;
          }
        } else if (bank === "telebirr") {
          const phone = request.phoneNumber || "0992013392";
          verifyPayload.phoneNumber = phone;
          verifyPayload.phone = phone;
          const teleCodeMatch = rawRef.match(/\b([A-Z0-9]{10,14})\b/i);
          if (teleCodeMatch) {
            verifyPayload.reference = teleCodeMatch[1].toUpperCase();
          }
        }

        if (request.senderIdentifier) {
          verifyPayload.sender_identifier = request.senderIdentifier;
        }

        const response = await fetch(`${this.baseUrl}/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "Idempotency-Key": key,
          },
          body: JSON.stringify(verifyPayload),
          signal: controller.signal,
        });

        clearTimeout(timer);

        // HTTP 202 Accepted: Verification is queued/pending by provider
        if (response.status === 202) {
          const data = await response.json();
          return {
            status: "pending",
            requestId: data.request_id ?? data.requestId ?? data.verification?.requestId ?? randomUUID(),
            transactionReference: request.transactionReference,
            amount: request.expectedAmount,
            currency: "ETB",
          };
        }

        // HTTP 200 OK: Immediate verification outcome
        if (response.ok) {
          const data = await response.json();
          const firstData = Array.isArray(data.data) ? data.data[0] : data.data;
          const isVerified =
            data.status === "verified" ||
            data.success === true ||
            firstData?.verified === true ||
            firstData?.status === "success" ||
            data.verification?.verified === true ||
            data.verified === true;

          const receiverName = firstData?.receiverName ?? firstData?.receiver ?? data.receiver;
          const receiverAccount = firstData?.receiverAccount ?? data.receiverAccount;

          return {
            status: isVerified ? "verified" : "failed",
            requestId: data.request_id ?? data.requestId ?? data.verification?.requestId ?? randomUUID(),
            transactionReference:
              firstData?.referenceNumber ??
              firstData?.receiptNumber ??
              request.transactionReference,
            amount: Number(firstData?.amount ?? data.amount ?? request.expectedAmount),
            currency: firstData?.currency ?? data.currency ?? "ETB",
            receiver: receiverName,
            receiverAccount: receiverAccount,
            sender: firstData?.senderName ?? data.sender,
            verifiedAt:
              firstData?.timestamp ??
              data.verified_at ??
              data.verifiedAt ??
              new Date().toISOString(),
            rawMetadata: data,
          };
        }

        // Transient 5xx server errors qualify for retry
        if (response.status >= 500 && attempt < this.maxRetries) {
          attempt++;
          logger.warn(`Verify.ET returned ${response.status}; retrying attempt ${attempt}...`);
          await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt)));
          continue;
        }

        const errorBody = await response.text();
        let clientMessage = `Verify.ET API error [${response.status}]: ${errorBody}`;
        try {
          const parsed = JSON.parse(errorBody);
          if (parsed && typeof parsed === "object" && parsed.message) {
            clientMessage = parsed.message;
          }
        } catch {
          // keep errorBody
        }

        throw new AppError(
          clientMessage,
          response.status >= 400 && response.status < 500 ? response.status : 500,
          response.status >= 400 && response.status < 500 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR"
        );
      } catch (err) {
        clearTimeout(timer);

        if (err instanceof Error && err.name === "AbortError") {
          if (attempt < this.maxRetries) {
            attempt++;
            logger.warn(`Verify.ET request timed out after ${this.timeoutMs}ms; retrying attempt ${attempt}...`);
            continue;
          }
          throw new AppError("Verify.ET request timed out", 504, "INTERNAL_SERVER_ERROR");
        }

        if (attempt < this.maxRetries && err instanceof Error && !err.message.includes("400")) {
          attempt++;
          await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt)));
          continue;
        }

        throw err;
      }
    }

    throw new AppError("Verify.ET retries exhausted", 502, "INTERNAL_SERVER_ERROR");
  }

  /**
   * Deterministic mock verification for offline development and unit tests.
   */
  private defaultMockVerification(request: VerifyEtVerifyRequest): VerifyEtVerifyResponse {
    const ref = request.transactionReference.trim().toUpperCase();

    // Specific deterministic testing fixtures:
    if (ref.includes("PENDING")) {
      return {
        status: "pending",
        requestId: `req-pending-${Date.now()}`,
        transactionReference: request.transactionReference,
        amount: request.expectedAmount,
        currency: "ETB",
      };
    }

    if (ref.includes("FAIL") || ref.includes("INVALID")) {
      return {
        status: "failed",
        requestId: `req-failed-${Date.now()}`,
        transactionReference: request.transactionReference,
        amount: 0,
        currency: "ETB",
        rawMetadata: { error: "Transaction not found at provider" },
      };
    }

    if (ref.includes("UNDERPAID")) {
      return {
        status: "verified",
        requestId: `req-underpaid-${Date.now()}`,
        transactionReference: request.transactionReference,
        amount: Math.round(request.expectedAmount / 2), // Half payment
        currency: "ETB",
        receiver: request.expectedReceiver,
        verifiedAt: new Date().toISOString(),
      };
    }

    // Default: Verified transaction matching expected amount
    return {
      status: "verified",
      requestId: `req-verified-${Date.now()}`,
      transactionReference: request.transactionReference,
      amount: request.expectedAmount,
      currency: "ETB",
      receiver: "Esrael Ashenafi",
      receiverAccount: request.bank === "cbe" ? "1000596935234" : "0992013392",
      sender: request.senderIdentifier ?? "+251911000000",
      verifiedAt: new Date().toISOString(),
      rawMetadata: { source: "mock_deterministic_verification" },
    };
  }
}

// Singleton client instance
let globalVerifyEtClient: VerifyEtClient | null = null;

export function getVerifyEtClient(): VerifyEtClient {
  if (!globalVerifyEtClient) {
    globalVerifyEtClient = new VerifyEtClient();
  }
  return globalVerifyEtClient;
}

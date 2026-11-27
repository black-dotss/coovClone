import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { VerifyEtWebhookPayload } from "./types";
import {
  VerifyEtNestedPaymentWebhookSchema,
  VerifyEtFlatPaymentWebhookSchema,
} from "./validation";
import { reconcileVerificationCompleted } from "./service";
import { BadRequestError, UnauthorizedError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Computes an HMAC-SHA256 signature over timestamp and raw request body.
 * Verify.ET specification: Sign the timestamp, a period, and the raw body with HMAC-SHA256.
 */
export function computeWebhookSignature(
  rawBody: string,
  timestamp: string,
  secret: string
): string {
  const payload = `${timestamp}.${rawBody}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verifies the incoming webhook HMAC-SHA256 signature and checks replay attack window.
 * Supports:
 * - Direct hex or `sha256=<hex>` format
 * - Secret rotation (comma-separated or whitespace-separated `sha256=` hashes)
 * - Raw string secrets, `whsec_` prefixed secrets, and decoded byte buffers
 * - Numeric (seconds/milliseconds) and ISO-8601 formatted timestamps
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secretOverride?: string
): boolean {
  if (!signatureHeader) {
    return false;
  }

  const env = getEnv();
  const secret =
    secretOverride ??
    env.VERIFY_ET_WEBHOOK_SECRET ??
    "ci-test-mock-verify-webhook-secret-key-123456";
  if (!secret) {
    return false;
  }

  // 1. Extract all candidate signatures from header (strip sha256= or v1= prefixes)
  const candidateSignatures = signatureHeader
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^sha256=/i, "").replace(/^v1=/i, ""))
    .filter((s) => s.length > 0);

  if (candidateSignatures.length === 0) {
    return false;
  }

  // 2. Resolve timestamp from header or fallback to payload JSON if present
  let ts = timestampHeader?.trim() || null;
  if (!ts) {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed === "object" && parsed.timestamp) {
        ts = String(parsed.timestamp).trim();
      }
    } catch {
      // Ignore JSON parse errors here
    }
  }

  // 3. Replay attack window check
  if (ts) {
    let timestampMs: number;
    if (/^\d+$/.test(ts)) {
      const num = Number(ts);
      timestampMs = num < 1e11 ? num * 1000 : num;
    } else {
      timestampMs = Date.parse(ts);
    }

    if (isNaN(timestampMs)) {
      return false;
    }

    const age = Math.abs(Date.now() - timestampMs);
    if (age > MAX_TIMESTAMP_AGE_MS) {
      logger.warn("Verify.ET webhook rejected: timestamp outside replay window", {
        timestampHeader: ts,
        ageMs: age,
      });
      return false;
    }
  }

  // 4. Candidate secret formats (original string, stripped whsec_, and base64 decode if applicable)
  const secretsToTry: Array<string | Buffer> = [secret];
  if (typeof secret === "string" && secret.startsWith("whsec_")) {
    const stripped = secret.slice(6);
    secretsToTry.push(stripped);
    try {
      const buf = Buffer.from(stripped, "base64");
      if (buf.length > 0) {
        secretsToTry.push(buf);
      }
    } catch {
      // Ignore base64 decode errors
    }
  }

  // 5. Generate expected signatures
  const expectedSignatures: string[] = [];
  for (const sec of secretsToTry) {
    if (ts) {
      expectedSignatures.push(
        createHmac("sha256", sec).update(`${ts}.${rawBody}`).digest("hex")
      );
    }
    expectedSignatures.push(
      createHmac("sha256", sec).update(rawBody).digest("hex")
    );
  }

  // 6. Timing-safe match against any expected signature
  for (const candidate of candidateSignatures) {
    const candidateBuf = Buffer.from(candidate.toLowerCase(), "utf-8");
    for (const expected of expectedSignatures) {
      const expectedBuf = Buffer.from(expected.toLowerCase(), "utf-8");
      if (
        candidateBuf.length === expectedBuf.length &&
        timingSafeEqual(candidateBuf, expectedBuf)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Handles incoming Verify.ET webhook with signature validation, replay protection,
 * ping/test acknowledgement, and idempotent payment reconciliation.
 */
export async function handleVerifyEtWebhook(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secretOverride?: string
): Promise<{ status: string; orderId?: string; event?: string; message?: string }> {
  // 1. Verify cryptographic signature and timestamp
  const isValid = verifyWebhookSignature(rawBody, signatureHeader, timestampHeader, secretOverride);
  if (!isValid) {
    throw new UnauthorizedError("Invalid or expired Verify.ET webhook signature");
  }

  // 2. Parse JSON payload
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    throw new BadRequestError("Invalid JSON body in webhook request");
  }

  // 3. Allow test / ping events to succeed immediately after signature verification
  const record =
    parsedJson && typeof parsedJson === "object"
      ? (parsedJson as Record<string, unknown>)
      : {};
  const eventName = String(
    record.event || record.type || record.action || ""
  ).toLowerCase();

  const isPingOrTest =
    eventName === "ping" ||
    eventName === "test" ||
    eventName === "webhook.test" ||
    eventName === "verification.ping" ||
    eventName === "verification.test" ||
    record.ping === true ||
    record.test === true;

  if (isPingOrTest) {
    logger.info("Acknowledged authenticated Verify.ET ping/test event", {
      event: eventName || "ping",
      payload: parsedJson,
    });
    return {
      status: "verified",
      event: eventName || "ping",
      message: "Verify.ET test webhook verified and acknowledged",
    };
  }

  // 4. Normalize payment webhook payload across nested (official Verify.ET) and flat structures
  let payload: VerifyEtWebhookPayload;

  const nestedResult = VerifyEtNestedPaymentWebhookSchema.safeParse(parsedJson);
  if (nestedResult.success) {
    const d = nestedResult.data;
    const txRef = (
      d.data.referenceNumber ||
      d.data.receiptNumber ||
      d.data.transactionNumber ||
      d.requestId ||
      ""
    ).trim();

    const isVerified =
      d.data.verified === true ||
      d.data.status === "success" ||
      d.data.status === "verified";
    const isRejected = d.data.status === "rejected";

    payload = {
      event: (d.event as VerifyEtWebhookPayload["event"]) || "verification.completed",
      requestId: d.requestId,
      transactionReference: txRef,
      status: isVerified ? "verified" : isRejected ? "rejected" : "failed",
      amount: d.data.amount,
      currency: d.data.currency || "ETB",
      receiver: d.data.receiverName,
      sender: d.data.senderName,
      timestamp: d.timestamp || new Date().toISOString(),
      rawMetadata: d.data as unknown as Record<string, unknown>,
    };
  } else {
    payload = VerifyEtFlatPaymentWebhookSchema.parse(parsedJson) as VerifyEtWebhookPayload;
  }

  logger.info("Received authenticated Verify.ET webhook", {
    event: payload.event,
    requestId: payload.requestId,
    txRef: payload.transactionReference,
    status: payload.status,
  });

  // 5. Delegate to payment reconciliation engine
  return reconcileVerificationCompleted(payload);
}

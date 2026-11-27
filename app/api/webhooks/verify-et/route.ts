import { handleVerifyEtWebhook } from "@/lib/payments/webhook";
import { successResponse, errorResponse } from "@/lib/shared";
import { AppError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

export async function GET(): Promise<Response> {
  return successResponse({
    status: "active",
    endpoint: "/api/webhooks/verify-et",
    provider: "Verify.ET",
    method: "POST",
    timestamp: new Date().toISOString(),
    message: "Verify.ET payment webhook listener is active and listening for POST events.",
  });
}

export async function POST(req: Request): Promise<Response> {
  // 1. Capture and log all incoming request headers and raw body right at the top
  const headersObj: Record<string, string> = {};
  req.headers.forEach((val, key) => {
    headersObj[key] = val;
  });

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    logger.error("Failed to read raw body from webhook", { err, headers: headersObj });
    return errorResponse(new AppError("Failed to read body", 400, "BAD_REQUEST"));
  }

  logger.info("Verify.ET Incoming Webhook Request", {
    headers: headersObj,
    body: rawBody,
  });

  // 2. Check test header per Verify.ET specification:
  // "A 2xx response makes the endpoint active. Test pings set X-Webhook-Test: true. Reply 204."
  const isTestPingHeader =
    req.headers.get("x-webhook-test") === "true" ||
    req.headers.get("webhook-test") === "true";

  if (isTestPingHeader) {
    logger.info("Verify.ET test ping received with X-Webhook-Test: true. Acknowledging with 204 No Content.", {
      headers: headersObj,
      body: rawBody,
    });
    return new Response(null, { status: 204 });
  }

  // 3. Extract signature and timestamp according to Verify.ET specification
  // Header: X-Webhook-Signature: sha256=<hex>
  // Header: X-Webhook-Timestamp: <timestamp>
  const signature =
    req.headers.get("x-webhook-signature") ||
    req.headers.get("webhook-signature") ||
    req.headers.get("x-verify-signature") ||
    req.headers.get("x-signature") ||
    req.headers.get("verify-signature") ||
    req.headers.get("signature");

  const timestamp =
    req.headers.get("x-webhook-timestamp") ||
    req.headers.get("webhook-timestamp") ||
    req.headers.get("x-verify-timestamp") ||
    req.headers.get("x-timestamp") ||
    req.headers.get("verify-timestamp") ||
    req.headers.get("timestamp");

  try {
    const outcome = await handleVerifyEtWebhook(rawBody, signature, timestamp);

    // Verify.ET specification: "Any 2xx. Return 204, then process the event."
    logger.info("Verify.ET webhook verified and processed successfully", {
      outcome,
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    logger.warn("Verify.ET webhook processing failed", {
      error: err instanceof Error ? err.message : String(err),
      headers: headersObj,
      body: rawBody,
    });
    return errorResponse(err);
  }
}

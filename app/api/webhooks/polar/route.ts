import {
  validateEvent,
  PolarWebhookVerificationError,
  PolarWebhookUnknownTypeError,
} from "@/lib/payments/polar-webhooks";
import { upgradeUserSubscriptionTier, revertUserToFreeTier } from "@/lib/billing";
import { successResponse } from "@/lib/shared";
import { logger } from "@/lib/shared/logger";
import { getEnv } from "@/lib/env";
import type { PlanTier } from "@/lib/billing/types";

export async function GET(): Promise<Response> {
  return successResponse({
    status: "active",
    endpoint: "/api/webhooks/polar",
    provider: "Polar.sh",
    method: "POST",
    timestamp: new Date().toISOString(),
    message: "Polar.sh payment webhook listener is active and listening for POST events.",
  });
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(val: unknown): val is string {
  return typeof val === "string" && UUID_REGEX.test(val.trim());
}

async function extractUserId(data: Record<string, unknown> | undefined): Promise<string | null> {
  if (!data) return null;
  const customer = data.customer as Record<string, unknown> | undefined;
  const metadata = data.metadata as Record<string, unknown> | undefined;
  const subscription = data.subscription as Record<string, unknown> | undefined;
  const subMetadata = subscription?.metadata as Record<string, unknown> | undefined;
  const user = data.user as Record<string, unknown> | undefined;

  // 1. Explicit app metadata set during checkout is primary & authoritative
  const metaCandidate =
    metadata?.userId ||
    metadata?.user_id ||
    subMetadata?.userId ||
    subMetadata?.user_id;

  if (isUuid(metaCandidate)) {
    return (metaCandidate as string).trim();
  }

  // 2. Customer external ID if valid UUID
  const externalCandidate =
    customer?.external_id ||
    customer?.externalId ||
    data.customerExternalId ||
    data.external_customer_id;

  if (isUuid(externalCandidate)) {
    return (externalCandidate as string).trim();
  }

  // 3. Email lookup against users table
  const emailCandidate =
    (customer?.email as string) ||
    (user?.email as string) ||
    (data.email as string);

  if (emailCandidate && typeof emailCandidate === "string") {
    try {
      const { db, users } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const [matched] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, emailCandidate.toLowerCase().trim()))
        .limit(1);

      if (matched?.id) {
        return matched.id;
      }
    } catch {
      // Non-blocking DB lookup fallback
    }
  }

  // 4. Fallback if meta or external ID exists as a non-empty string
  if (typeof metaCandidate === "string" && metaCandidate.trim().length > 0) {
    return metaCandidate.trim();
  }
  if (typeof externalCandidate === "string" && externalCandidate.trim().length > 0) {
    return externalCandidate.trim();
  }

  return null;
}

function extractPlanTier(data: Record<string, unknown> | undefined): PlanTier {
  if (!data) return "pro_monthly";
  const product = data.product as Record<string, unknown> | undefined;
  const productMeta = product?.metadata as Record<string, unknown> | undefined;
  const metadata = data.metadata as Record<string, unknown> | undefined;
  const subscription = data.subscription as Record<string, unknown> | undefined;
  const subMetadata = subscription?.metadata as Record<string, unknown> | undefined;

  const raw =
    productMeta?.plan_tier ||
    productMeta?.planTier ||
    metadata?.plan_tier ||
    metadata?.planTier ||
    subMetadata?.plan_tier ||
    subMetadata?.planTier;

  if (raw) {
    const lower = String(raw).toLowerCase().trim();
    if (
      lower === "executive_unlimited" ||
      lower === "unlimited_yearly" ||
      lower === "executive"
    ) {
      return "unlimited_yearly";
    }
    if (lower === "pro_plus_yearly") return "pro_plus_yearly";
    if (lower === "pro_yearly") return "pro_yearly";
    if (lower === "pro_plus_monthly") return "pro_plus_monthly";
    if (lower === "pro_monthly") return "pro_monthly";
  }

  // Match by configured product ID
  const productId =
    (data.product_id as string) ||
    (product?.id as string) ||
    (subscription?.product_id as string);

  if (productId) {
    try {
      const envObj = getEnv();
      if (
        productId === process.env.POLAR_PRODUCT_ID_PRO_PLUS_YEARLY ||
        productId === envObj.POLAR_PRODUCT_ID_PRO_PLUS_YEARLY
      ) {
        return "pro_plus_yearly";
      }
      if (
        productId === process.env.POLAR_PRODUCT_ID_EXECUTIVE_UNLIMITED ||
        productId === envObj.POLAR_PRODUCT_ID_EXECUTIVE_UNLIMITED ||
        productId === process.env.POLAR_PRODUCT_ID_UNLIMITED_YEARLY ||
        productId === envObj.POLAR_PRODUCT_ID_UNLIMITED_YEARLY
      ) {
        return "unlimited_yearly";
      }
      if (
        productId === process.env.POLAR_PRODUCT_ID_PRO_PLUS_MONTHLY ||
        productId === envObj.POLAR_PRODUCT_ID_PRO_PLUS_MONTHLY
      ) {
        return "pro_plus_monthly";
      }
      if (
        productId === process.env.POLAR_PRODUCT_ID_PRO_MONTHLY ||
        productId === envObj.POLAR_PRODUCT_ID_PRO_MONTHLY
      ) {
        return "pro_monthly";
      }
    } catch {
      // Fallback
    }
  }

  // Fallback by product name / description keywords
  const productName = (
    (product?.name as string) ||
    (data.description as string) ||
    ""
  ).toLowerCase();

  if (productName.includes("executive") || productName.includes("unlimited")) {
    return "unlimited_yearly";
  }
  if (productName.includes("plus") && (productName.includes("year") || productName.includes("annual"))) {
    return "pro_plus_yearly";
  }
  if (productName.includes("plus")) {
    return "pro_plus_monthly";
  }
  if (productName.includes("year") || productName.includes("annual")) {
    return "pro_yearly";
  }

  return "pro_monthly";
}

export async function POST(req: Request): Promise<Response> {
  const headersObj: Record<string, string> = {};
  req.headers.forEach((val, key) => {
    headersObj[key.toLowerCase()] = val;
  });

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    logger.error("Failed to read raw body from Polar webhook", { err });
    return new Response(JSON.stringify({ error: "Failed to read body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const webhookSecret =
    process.env.POLAR_WEBHOOK_SECRET ||
    (function () {
      try {
        return getEnv().POLAR_WEBHOOK_SECRET;
      } catch {
        return undefined;
      }
    })();

  if (!webhookSecret) {
    logger.error("POLAR_WEBHOOK_SECRET is not configured on server");
    return new Response(
      JSON.stringify({
        error: "POLAR_WEBHOOK_SECRET is not configured",
        message: "Please configure POLAR_WEBHOOK_SECRET in your production hosting environment variables.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  let event: { type: string; data?: Record<string, unknown> };
  try {
    event = (await validateEvent(rawBody, headersObj, webhookSecret)) as unknown as {
      type: string;
      data?: Record<string, unknown>;
    };
  } catch (err: unknown) {
    const errName = (err as Error)?.name;
    if (err instanceof PolarWebhookVerificationError || errName === "PolarWebhookVerificationError") {
      logger.warn("Polar webhook signature verification failed", {
        headers: headersObj,
      });
      return new Response(
        JSON.stringify({ error: "Invalid webhook signature" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (err instanceof PolarWebhookUnknownTypeError || errName === "PolarWebhookUnknownTypeError") {
      logger.info("Polar webhook signature verified; acknowledging unmapped event type", {
        eventType: (err as { eventType?: string })?.eventType,
      });
      return new Response(
        JSON.stringify({ received: true, ignored: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    logger.warn("Polar webhook parsing or event validation failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      JSON.stringify({ error: "Invalid webhook payload" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const { type, data } = event;
  const userId = await extractUserId(data);

  logger.info("Received validated Polar webhook event", {
    eventType: type,
    userId,
  });

  try {
    const isPaidOrder =
      type === "order.paid" ||
      (type === "order.created" && (data?.status === "paid" || data?.paid === true)) ||
      (type === "order.updated" && (data?.status === "paid" || data?.paid === true));

    const isSubscriptionActive =
      type === "subscription.active" ||
      (type === "subscription.created" && data?.status === "active") ||
      (type === "subscription.updated" && data?.status === "active");

    if (isPaidOrder || isSubscriptionActive) {
      if (userId) {
        const planTier = extractPlanTier(data);
        const subObj = data?.subscription as Record<string, unknown> | undefined;
        let periodStart: Date | undefined;
        let periodEnd: Date | undefined;

        try {
          const rawStart = data?.current_period_start || subObj?.current_period_start;
          if (rawStart) {
            const d = new Date(String(rawStart));
            if (!isNaN(d.getTime())) periodStart = d;
          }
          const rawEnd = data?.current_period_end || subObj?.current_period_end;
          if (rawEnd) {
            const d = new Date(String(rawEnd));
            if (!isNaN(d.getTime())) periodEnd = d;
          }
        } catch {
          // Fallback to undefined so upgradeUserSubscriptionTier calculates duration
        }

        await upgradeUserSubscriptionTier({
          userId,
          planTier,
          periodStart,
          periodEnd,
        });

        logger.info("Successfully upgraded user tier from Polar webhook", {
          userId,
          planTier,
          eventType: type,
        });
      } else {
        logger.warn("Polar upgrade event missing identifiable userId", {
          eventType: type,
        });
      }
    } else if (type === "subscription.revoked") {
      if (userId) {
        await revertUserToFreeTier(userId);
        logger.info("Successfully reverted user to free tier from Polar webhook", {
          userId,
          eventType: type,
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const cause =
      err && typeof err === "object" && "cause" in err
        ? (err as { cause: unknown }).cause
        : undefined;
    const causeMessage =
      cause instanceof Error
        ? cause.message
        : typeof cause === "object" && cause !== null
        ? JSON.stringify(cause)
        : String(cause || "");

    logger.error("Error processing Polar webhook event", {
      err,
      message,
      cause: causeMessage,
      eventType: type,
      userId,
    });
    return new Response(
      JSON.stringify({
        error: "Internal processing error",
        message,
        cause: causeMessage,
        stack,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

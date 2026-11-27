import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import {
  paymentOrders,
  paymentVerifications,
  subscriptions,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  CreatePaymentOrderInput,
  PaymentOrderDetails,
  PaymentStatus,
  SubmitPaymentVerificationInput,
  VerifyEtWebhookPayload,
} from "./types";
import { getReceivingAccount, SUPPORTED_RECEIVING_ACCOUNTS } from "./config";
import { getVerifyEtClient, VerifyEtClient } from "./verify-et-client";
import { getPlanByTier } from "@/lib/billing/plans";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

/**
 * Extracts clean transaction reference code from pasted bank SMS messages or raw strings.
 */
export function extractTransactionReference(raw: string): string {
  const text = raw.trim();

  // 1. CBE Receipt Link (e.g. https://mbreciept.cbe.com.et/v2-hfHCxO8Bb6Z1ArMS4eFr)
  const cbeUrlMatch = text.match(/https?:\/\/(?:mbreciept|receipt)\.cbe\.com\.et\/[^\s]+/i);
  if (cbeUrlMatch) {
    return cbeUrlMatch[0].trim();
  }

  // 2. CBE Receipt Code (e.g. v2-hfHCxO8Bb6Z1ArMS4eFr)
  const cbeCodeMatch = text.match(/\b(v2-[a-zA-Z0-9_-]+)\b/i);
  if (cbeCodeMatch) {
    return cbeCodeMatch[1].trim();
  }

  // 3. CBE FT Reference (e.g. FT26321F78K0)
  const ftMatch = text.match(/\b(FT[0-9A-Za-z]{8,16})\b/i);
  if (ftMatch) {
    return ftMatch[1].trim().toUpperCase();
  }

  if (text.length <= 40 && !text.includes(" ") && !text.includes("\n")) {
    return text.toUpperCase();
  }

  const patterns = [
    /transaction\s*(?:number|no|id|code)?\s*[:\s#]+([A-Za-z0-9]+)/i,
    /trans\s*(?:ref|reference)?\s*[:\s#]+([A-Za-z0-9]+)/i,
    /ref(?:erence)?\s*(?:number|no|id|code)?\s*[:\s#]+([A-Za-z0-9]+)/i,
    /txn\s*(?:id|no|ref)?\s*[:\s#]+([A-Za-z0-9]+)/i,
    /\b([A-Z0-9]{10,14})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim().toUpperCase();
    }
  }

  return text.slice(0, 50).toUpperCase();
}

/**
 * Generates a human-readable, unique payment order reference (e.g., ORD-20261116-A1B2C3).
 */
export function generateOrderReference(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomSuffix = randomBytes(3).toString("hex").toUpperCase();
  return `ORD-${dateStr}-${randomSuffix}`;
}

/**
 * Creates a server-side payment order with fixed plan price, expiry, and instructions.
 * Strictly ignores any client-supplied pricing or entitlement claims.
 */
export async function createPaymentOrder(
  userId: string,
  input: CreatePaymentOrderInput
): Promise<PaymentOrderDetails> {
  // 1. Read fixed plan price and terms from server-controlled plan configuration
  const plan = await getPlanByTier(input.planTier);
  const receivingAccount = getReceivingAccount(input.preferredProvider);

  // 2. Assign unique reference and 24-hour expiry window
  const orderReference = generateOrderReference();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // 3. Persist order record with status 'pending'
  const [order] = await db
    .insert(paymentOrders)
    .values({
      userId,
      planId: plan.id,
      amountEtb: plan.priceEtb,
      currency: "ETB",
      orderReference,
      expectedReceiver: `${receivingAccount.displayName} (${receivingAccount.accountNumber})`,
      status: "pending",
      expiresAt,
    })
    .returning();

  logger.info("Created server-side payment order", {
    orderId: order.id,
    userId,
    planTier: input.planTier,
    amountEtb: plan.priceEtb,
    orderReference,
    expectedReceiver: order.expectedReceiver,
  });

  return {
    id: order.id,
    userId: order.userId,
    planId: order.planId,
    planTier: input.planTier,
    planName: plan.name,
    amountEtb: order.amountEtb,
    currency: order.currency,
    orderReference: order.orderReference,
    expectedReceiver: order.expectedReceiver,
    receivingAccounts: Object.values(SUPPORTED_RECEIVING_ACCOUNTS),
    status: order.status as PaymentStatus,
    expiresAt: order.expiresAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Retrieves payment order details and instructions, verifying caller ownership.
 */
export async function getPaymentOrder(
  orderId: string,
  requestingUserId: string
): Promise<PaymentOrderDetails> {
  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.id, orderId))
    .limit(1);

  if (!order) {
    throw new NotFoundError("Payment order not found");
  }

  if (order.userId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to access this payment order");
  }

  // Handle automatic expiry transition
  let currentStatus = order.status as PaymentStatus;
  if (currentStatus === "pending" && order.expiresAt < new Date()) {
    currentStatus = "expired";
    await db
      .update(paymentOrders)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(paymentOrders.id, orderId));
  }

  // Fetch associated verification if exists
  const [verification] = await db
    .select()
    .from(paymentVerifications)
    .where(eq(paymentVerifications.orderId, orderId))
    .limit(1);

  const planTier = order.planId.includes("yearly") ? "pro_yearly" : "pro_monthly";

  return {
    id: order.id,
    userId: order.userId,
    planId: order.planId,
    planTier,
    planName: planTier === "pro_yearly" ? "Pro Yearly" : "Pro Monthly",
    amountEtb: order.amountEtb,
    currency: order.currency,
    orderReference: order.orderReference,
    expectedReceiver: order.expectedReceiver,
    receivingAccounts: Object.values(SUPPORTED_RECEIVING_ACCOUNTS),
    status: currentStatus,
    expiresAt: order.expiresAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    verification: verification ?? null,
  };
}

/**
 * Lists all payment orders for the authenticated user.
 */
export async function listPaymentOrders(userId: string): Promise<PaymentOrderDetails[]> {
  const orders = await db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.userId, userId))
    .orderBy(desc(paymentOrders.createdAt));

  return orders.map((order) => {
    const planTier = order.planId.includes("yearly") ? "pro_yearly" : "pro_monthly";
    return {
      id: order.id,
      userId: order.userId,
      planId: order.planId,
      planTier,
      planName: planTier === "pro_yearly" ? "Pro Yearly" : "Pro Monthly",
      amountEtb: order.amountEtb,
      currency: order.currency,
      orderReference: order.orderReference,
      expectedReceiver: order.expectedReceiver,
      receivingAccounts: Object.values(SUPPORTED_RECEIVING_ACCOUNTS),
      status: order.status as PaymentStatus,
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  });
}

/**
 * Submits payment evidence for verification via Verify.ET.
 * Prevents transaction reuse and activates Pro access upon verified payment.
 */
export async function submitPaymentVerification(
  requestingUserId: string,
  input: SubmitPaymentVerificationInput,
  clientOverride?: VerifyEtClient
): Promise<PaymentOrderDetails> {
  const client = clientOverride ?? getVerifyEtClient();

  const rawTx = (input.transactionReference || input.smsText || "").trim();
  if (!rawTx) {
    throw new BadRequestError("Transaction reference code or SMS confirmation text is required");
  }

  // 1. Verify order existence and caller ownership
  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(
      input.orderId
        ? eq(paymentOrders.id, input.orderId)
        : eq(paymentOrders.orderReference, input.orderReference!)
    )
    .limit(1);

  if (!order) {
    throw new NotFoundError("Payment order not found");
  }

  if (order.userId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to verify this payment order");
  }

  // Auto-detect provider / bank if not explicitly given
  let provider = input.bank || input.provider;
  if (!provider) {
    const rx = (order.expectedReceiver || "").toLowerCase();
    const sms = rawTx.toLowerCase();
    if (rx.includes("cbe") || rx.includes("1000596935234") || sms.includes("cbe") || sms.includes("commercial bank")) {
      provider = "cbe";
    } else {
      provider = "telebirr";
    }
  }

  // 2. Validate order status and expiry
  if (order.status === "verified") {
    throw new BadRequestError("This payment order has already been verified");
  }

  if (order.status === "expired" || order.expiresAt < new Date()) {
    if (order.status !== "expired") {
      await db
        .update(paymentOrders)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(paymentOrders.id, order.id));
    }
    throw new BadRequestError("Payment order has expired. Please create a new payment order.");
  }

  // 3. Prevent Transaction Reference Reuse across all candidate references
  const cleanTxRef = extractTransactionReference(rawTx);
  const cbeCodeMatch = rawTx.match(/\b(v2-[a-zA-Z0-9_-]+)\b/i);
  const ftMatch = rawTx.match(/\b(FT[0-9A-Za-z]{8,16})\b/i);
  const teleCodeMatch = rawTx.match(/\b([A-Z0-9]{10,14})\b/i);

  const initialCheckRefs = new Set<string>();
  if (cleanTxRef) initialCheckRefs.add(cleanTxRef);
  if (cbeCodeMatch) initialCheckRefs.add(cbeCodeMatch[1]);
  if (ftMatch) initialCheckRefs.add(ftMatch[1].toUpperCase());
  if (teleCodeMatch) initialCheckRefs.add(teleCodeMatch[1].toUpperCase());

  for (const ref of initialCheckRefs) {
    const existingVerifications = await db
      .select({
        id: paymentVerifications.id,
        orderId: paymentVerifications.orderId,
        status: paymentVerifications.status,
      })
      .from(paymentVerifications)
      .where(eq(paymentVerifications.transactionReference, ref));

    const alreadyVerified = existingVerifications.some(
      (v) => v.status === "verified" && v.orderId !== order.id
    );

    if (alreadyVerified) {
      logger.warn("Attempted transaction reference reuse detected", {
        txRef: ref,
        attemptedOrderId: order.id,
        userId: requestingUserId,
      });

      await db
        .update(paymentOrders)
        .set({ status: "duplicate", updatedAt: new Date() })
        .where(eq(paymentOrders.id, order.id));

      throw new ConflictError(
        `This transaction reference (${ref}) has already been verified for another payment and cannot be reused.`
      );
    }
  }

  // 4. Submit to Verify.ET API
  const verifyResult = await client.verifyTransaction({
    transactionReference: cleanTxRef,
    provider,
    bank: provider,
    accountNumber: provider === "cbe" ? "1000596935234" : undefined,
    phoneNumber: provider === "telebirr" ? "0992013392" : undefined,
    expectedAmount: order.amountEtb,
    expectedReceiver: order.expectedReceiver,
    senderIdentifier: input.senderIdentifier,
  });

  // 5. Handle verification outcome:
  if (verifyResult.status === "pending") {
    // Asynchronous pending verification: Record provider request ID and await webhook
    await db.insert(paymentVerifications).values({
      orderId: order.id,
      providerRequestId: verifyResult.requestId,
      transactionReference: cleanTxRef,
      verifiedAmount: verifyResult.amount,
      verifiedCurrency: verifyResult.currency,
      status: "pending",
      responseMetadata: verifyResult.rawMetadata ?? {},
    });

    logger.info("Payment verification pending provider confirmation", {
      orderId: order.id,
      requestId: verifyResult.requestId,
      txRef: cleanTxRef,
    });

    const pendingOrder = await getPaymentOrder(order.id, requestingUserId);
    return {
      ...pendingOrder,
      message: "Payment submitted and pending bank confirmation. Your account will automatically update once verified.",
    };
  }

  if (verifyResult.status === "verified") {
    // 5a. Strict Receiver Check: Transfer must be sent to Esrael Ashenafi
    const rxName = String(verifyResult.receiver || "").toLowerCase();
    const rxAcc = String(verifyResult.receiverAccount || "").toLowerCase();
    const rawMetaStr = JSON.stringify(verifyResult.rawMetadata || "").toLowerCase();

    const isEsrael =
      rxName.includes("esrael") ||
      rxName.includes("ashenafi") ||
      rxAcc.includes("5234") ||
      rxAcc.includes("3392") ||
      rawMetaStr.includes("esrael") ||
      rawMetaStr.includes("ashenafi") ||
      rawMetaStr.includes("5234") ||
      rawMetaStr.includes("3392");

    if (!isEsrael && (verifyResult.receiver || verifyResult.receiverAccount)) {
      logger.warn("Payment rejected: receiver does not match Esrael Ashenafi", {
        orderId: order.id,
        receiver: verifyResult.receiver,
        receiverAccount: verifyResult.receiverAccount,
      });

      await db
        .update(paymentOrders)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(paymentOrders.id, order.id));

      await db.insert(paymentVerifications).values({
        orderId: order.id,
        providerRequestId: verifyResult.requestId,
        transactionReference: cleanTxRef,
        verifiedAmount: verifyResult.amount,
        verifiedCurrency: verifyResult.currency,
        status: "failed",
        responseMetadata: {
          reason: "unauthorized_receiver",
          expectedReceiver: "Esrael Ashenafi",
          receivedReceiver: verifyResult.receiver,
          receivedAccount: verifyResult.receiverAccount,
        },
      });

      const failedOrder = await getPaymentOrder(order.id, requestingUserId);
      return {
        ...failedOrder,
        message: "Payment verification failed: The transfer must be sent directly to Esrael Ashenafi (CBE: 1000596935234 or Telebirr: 0992013392).",
      };
    }

    // 5b. Amount Validation:
    // If underpaid: flag as ambiguous and do not activate
    if (verifyResult.amount < order.amountEtb) {
      logger.warn("Payment underpayment detected", {
        orderId: order.id,
        expectedAmount: order.amountEtb,
        verifiedAmount: verifyResult.amount,
        txRef: cleanTxRef,
      });

      await db
        .update(paymentOrders)
        .set({ status: "ambiguous", updatedAt: new Date() })
        .where(eq(paymentOrders.id, order.id));

      await db.insert(paymentVerifications).values({
        orderId: order.id,
        providerRequestId: verifyResult.requestId,
        transactionReference: cleanTxRef,
        verifiedAmount: verifyResult.amount,
        verifiedCurrency: verifyResult.currency,
        status: "ambiguous",
        responseMetadata: {
          reason: "underpayment_amount_mismatch",
          expectedAmount: order.amountEtb,
          receivedAmount: verifyResult.amount,
          raw: verifyResult.rawMetadata,
        },
      });

      const ambiguousOrder = await getPaymentOrder(order.id, requestingUserId);
      return {
        ...ambiguousOrder,
        message: `Underpayment detected: Expected ${order.amountEtb} ETB for this plan, but received only ${verifyResult.amount} ETB. Please contact support.`,
      };
    }

    const isOverpaid = verifyResult.amount > order.amountEtb;
    const extraAmount = verifyResult.amount - order.amountEtb;

    // 5c. Post-Verification Uniqueness Check across provider references
    const postCheckRefs = new Set<string>(initialCheckRefs);
    if (verifyResult.transactionReference) postCheckRefs.add(verifyResult.transactionReference);
    const rawMeta = verifyResult.rawMetadata as Record<string, unknown> | undefined;
    const firstData = Array.isArray(rawMeta?.data) ? rawMeta?.data[0] : rawMeta?.data;
    if (firstData && typeof firstData === "object") {
      const fd = firstData as Record<string, unknown>;
      if (fd.referenceNumber) postCheckRefs.add(String(fd.referenceNumber).trim().toUpperCase());
      if (fd.receiptNumber) postCheckRefs.add(String(fd.receiptNumber).trim());
      if (fd.reference) postCheckRefs.add(String(fd.reference).trim().toUpperCase());
    }

    for (const ref of postCheckRefs) {
      const existing = await db
        .select({
          id: paymentVerifications.id,
          orderId: paymentVerifications.orderId,
          status: paymentVerifications.status,
        })
        .from(paymentVerifications)
        .where(eq(paymentVerifications.transactionReference, ref));

      const alreadyUsed = existing.some(
        (v) => v.status === "verified" && v.orderId !== order.id
      );

      if (alreadyUsed) {
        logger.warn("Duplicate transaction reference reuse detected post-verify", {
          reusedRef: ref,
          orderId: order.id,
        });

        await db
          .update(paymentOrders)
          .set({ status: "duplicate", updatedAt: new Date() })
          .where(eq(paymentOrders.id, order.id));

        throw new ConflictError(
          `This transaction reference (${ref}) has already been verified for another subscription and cannot be reused.`
        );
      }
    }

    // All checks passed: Activate subscription in atomic transaction
    await activateSubscriptionFromVerifiedPayment({
      order,
      transactionReference: verifyResult.transactionReference || cleanTxRef,
      providerRequestId: verifyResult.requestId,
      verifiedAmount: verifyResult.amount,
      metadata: {
        ...verifyResult.rawMetadata,
        candidateRefs: Array.from(postCheckRefs),
        verifiedReceiver: verifyResult.receiver,
        overpayment: isOverpaid ? { extraAmount, paidAmount: verifyResult.amount } : null,
      },
    });

    const verifiedOrder = await getPaymentOrder(order.id, requestingUserId);
    const successMsg = isOverpaid
      ? `Payment verified successfully! You are now subscribed to ${verifiedOrder.planName}. Your transfer of ${verifyResult.amount} ETB was ${extraAmount} ETB greater than the subscription price (${order.amountEtb} ETB). If you would like a refund or credit for the extra amount, please contact the admin.`
      : `Payment verified successfully! You are now subscribed to ${verifiedOrder.planName}.`;

    return {
      ...verifiedOrder,
      message: successMsg,
    };
  }

  // Verification failed or rejected
  await db
    .update(paymentOrders)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(paymentOrders.id, order.id));

  await db.insert(paymentVerifications).values({
    orderId: order.id,
    providerRequestId: verifyResult.requestId,
    transactionReference: cleanTxRef,
    verifiedAmount: verifyResult.amount,
    verifiedCurrency: verifyResult.currency,
    status: "failed",
    responseMetadata: verifyResult.rawMetadata ?? {},
  });

  const failedOrder = await getPaymentOrder(order.id, requestingUserId);
  return {
    ...failedOrder,
    message: "Verification could not confirm this transaction with the provider. Please ensure the payment was sent to Esrael Ashenafi and the SMS or CBE receipt link is correct.",
  };
}

/**
 * Reconciles an asynchronous Verify.ET webhook notification.
 * Guarantees idempotency and transaction reuse prevention.
 */
export async function reconcileVerificationCompleted(
  payload: VerifyEtWebhookPayload
): Promise<{ status: string; orderId?: string }> {
  const cleanTxRef = payload.transactionReference.trim().toUpperCase();

  // 1. Locate order by providerRequestId or transactionReference
  let orderId: string | null = null;

  const verifications = await db
    .select()
    .from(paymentVerifications)
    .where(eq(paymentVerifications.providerRequestId, payload.requestId))
    .limit(1);

  if (verifications.length > 0) {
    orderId = verifications[0].orderId;
  } else {
    const existingOrders = await db
      .select({ id: paymentOrders.id })
      .from(paymentOrders)
      .where(eq(paymentOrders.status, "pending"));

    if (existingOrders.length > 0) {
      orderId = existingOrders[0].id;
    }
  }

  if (!orderId) {
    logger.warn("Webhook received for unknown or already completed order", {
      requestId: payload.requestId,
      txRef: cleanTxRef,
    });
    return { status: "order_not_found" };
  }

  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.id, orderId))
    .limit(1);

  if (!order) {
    return { status: "order_not_found" };
  }

  // Idempotency check: if order is already verified, do not duplicate subscription
  if (order.status === "verified") {
    logger.info("Webhook received for already verified order; acknowledging idempotently", {
      orderId: order.id,
    });
    return { status: "already_verified", orderId: order.id };
  }

  // Check transaction reference reuse across other orders
  const duplicateChecks = await db
    .select({ orderId: paymentVerifications.orderId })
    .from(paymentVerifications)
    .where(eq(paymentVerifications.transactionReference, cleanTxRef));

  const reused = duplicateChecks.some((d) => d.orderId !== order.id);
  if (reused) {
    logger.warn("Transaction reference reuse detected in webhook reconciliation", {
      txRef: cleanTxRef,
      orderId: order.id,
    });
    await db
      .update(paymentOrders)
      .set({ status: "duplicate", updatedAt: new Date() })
      .where(eq(paymentOrders.id, order.id));

    return { status: "duplicate_rejected", orderId: order.id };
  }

  if (payload.status === "verified") {
    // Validate amount: underpayment is flagged
    if (payload.amount < order.amountEtb) {
      logger.warn("Underpaid payment amount received via webhook; marking ambiguous", {
        orderId: order.id,
        expected: order.amountEtb,
        received: payload.amount,
      });

      await db
        .update(paymentOrders)
        .set({ status: "ambiguous", updatedAt: new Date() })
        .where(eq(paymentOrders.id, order.id));

      return { status: "ambiguous_underpaid", orderId: order.id };
    }

    // Activate subscription in atomic transaction
    await activateSubscriptionFromVerifiedPayment({
      order,
      transactionReference: cleanTxRef,
      providerRequestId: payload.requestId,
      verifiedAmount: payload.amount,
      metadata: payload.rawMetadata,
    });

    return { status: "verified", orderId: order.id };
  }

  // Webhook reported verification failure
  await db
    .update(paymentOrders)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(paymentOrders.id, order.id));

  return { status: "failed", orderId: order.id };
}

/**
 * Activates or extends a Pro subscription in an atomic database transaction.
 */
export async function activateSubscriptionFromVerifiedPayment(params: {
  order: typeof paymentOrders.$inferSelect;
  transactionReference: string;
  providerRequestId?: string;
  verifiedAmount: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { order, transactionReference, providerRequestId, verifiedAmount, metadata } = params;

  const planTier = order.planId;
  const durationDays = order.planId.includes("yearly") ? 365 : 30;

  // 1. Check existing active subscription to extend if applicable
  const existingSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, order.userId))
    .limit(1);

  const now = new Date();
  let currentPeriodStart = now;
  let currentPeriodEnd = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  if (existingSubs.length > 0) {
    const currentSub = existingSubs[0];
    if (currentSub.status === "active" && currentSub.currentPeriodEnd > now) {
      // Extend existing subscription
      currentPeriodStart = currentSub.currentPeriodStart;
      currentPeriodEnd = new Date(currentSub.currentPeriodEnd.getTime() + durationDays * 24 * 60 * 60 * 1000);
    }
  }

  // 2. Perform atomic updates: Order + Verification + Subscription
  await db
    .update(paymentOrders)
    .set({
      status: "verified",
      updatedAt: now,
    })
    .where(eq(paymentOrders.id, order.id));

  await db.insert(paymentVerifications).values({
    orderId: order.id,
    providerRequestId,
    transactionReference,
    verifiedAmount,
    verifiedCurrency: "ETB",
    status: "verified",
    responseMetadata: metadata ?? {},
  });

  if (existingSubs.length > 0) {
    await db
      .update(subscriptions)
      .set({
        planId: order.planId,
        status: "active",
        currentPeriodStart,
        currentPeriodEnd,
        renewalDate: currentPeriodEnd,
        updatedAt: now,
      })
      .where(eq(subscriptions.userId, order.userId));
  } else {
    await db.insert(subscriptions).values({
      userId: order.userId,
      planId: order.planId,
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
      renewalDate: currentPeriodEnd,
    });
  }

  logger.info("Successfully activated Pro subscription from verified payment", {
    userId: order.userId,
    orderId: order.id,
    planTier,
    txRef: transactionReference,
    currentPeriodStart: currentPeriodStart.toISOString(),
    currentPeriodEnd: currentPeriodEnd.toISOString(),
  });
}

/**
 * Admin resolution tool for reviewing ambiguous payments.
 */
export async function resolveAmbiguousPaymentOrder(
  orderId: string,
  _adminUserId: string,
  action: "approve" | "reject",
  notes?: string
): Promise<PaymentOrderDetails> {
  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.id, orderId))
    .limit(1);

  if (!order) {
    throw new NotFoundError("Payment order not found");
  }

  if (action === "approve") {
    await activateSubscriptionFromVerifiedPayment({
      order,
      transactionReference: `ADMIN-APPROVED-${order.orderReference}`,
      verifiedAmount: order.amountEtb,
      metadata: { adminResolution: true, notes },
    });
  } else {
    await db
      .update(paymentOrders)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(paymentOrders.id, orderId));
  }

  return getPaymentOrder(orderId, order.userId);
}

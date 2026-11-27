import { PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { paymentOrders, paymentVerifications } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { upgradeUserSubscriptionTier } from "@/lib/billing/subscriptions";
import { seedDefaultPlans } from "@/lib/billing/plans";
import type { PlanTier } from "@/lib/billing/types";
import {
  BadRequestError,
  ConflictError,
  createApiHandler,
  successResponse,
} from "@/lib/shared";
import {
  getExplorerTxUrl,
  prepareUsdcPlanPaymentTx,
  verifyUsdcTransferTransaction,
} from "@/lib/solana";

const USDC_PLAN_CATALOG: Record<
  string,
  { tier: PlanTier; planId: string; usdcAmount: number }
> = {
  pro_monthly: { tier: "pro_monthly", planId: "plan_pro_monthly", usdcAmount: 5 },
  pro_plus_monthly: {
    tier: "pro_plus_monthly",
    planId: "plan_pro_plus_monthly",
    usdcAmount: 9,
  },
  pro_yearly: { tier: "pro_yearly", planId: "plan_pro_yearly", usdcAmount: 29 },
  pro_plus_yearly: {
    tier: "pro_plus_yearly",
    planId: "plan_pro_plus_yearly",
    usdcAmount: 49,
  },
  unlimited_yearly: {
    tier: "unlimited_yearly",
    planId: "plan_unlimited_yearly",
    usdcAmount: 99,
  },
  executive_unlimited: {
    tier: "unlimited_yearly",
    planId: "plan_unlimited_yearly",
    usdcAmount: 99,
  },
};

const PreparePaymentSchema = z.object({
  planTier: z.string().min(2).max(64),
  walletAddress: z.string().min(32).max(64),
});

const ConfirmPaymentSchema = z.object({
  orderId: z.string().uuid().optional(),
  planTier: z.string().min(2).max(64),
  walletAddress: z.string().min(32).max(64),
  txSignature: z.string().min(32).max(128),
});

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const parsed = PreparePaymentSchema.parse(body);

  let payerWallet: string;
  try {
    payerWallet = new PublicKey(parsed.walletAddress).toBase58();
  } catch {
    throw new BadRequestError("Invalid Solana wallet address");
  }

  const catalog = USDC_PLAN_CATALOG[parsed.planTier];
  if (!catalog) {
    throw new BadRequestError(`Unsupported plan tier: ${parsed.planTier}`);
  }

  await seedDefaultPlans();

  const prepared = await prepareUsdcPlanPaymentTx({
    payerWallet,
    usdcAmount: catalog.usdcAmount,
  });

  const orderRef = `USDC-${Date.now().toString(36).toUpperCase()}-${globalThis.crypto
    .randomUUID()
    .slice(0, 6)
    .toUpperCase()}`;

  const [order] = await db
    .insert(paymentOrders)
    .values({
      userId: session.user.id,
      planId: catalog.planId,
      amountEtb: catalog.usdcAmount,
      currency: "USDC",
      orderReference: orderRef,
      expectedReceiver: prepared.treasuryWallet,
      status: "pending",
      expiresAt: new Date(Date.now() + 30 * 60_000),
    })
    .returning();

  return successResponse(
    {
      orderId: order.id,
      orderReference: order.orderReference,
      planTier: catalog.tier,
      ...prepared,
    },
    { status: 201 }
  );
});

export const PATCH = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const parsed = ConfirmPaymentSchema.parse(body);

  let payerWallet: string;
  try {
    payerWallet = new PublicKey(parsed.walletAddress).toBase58();
  } catch {
    throw new BadRequestError("Invalid Solana wallet address");
  }

  const catalog = USDC_PLAN_CATALOG[parsed.planTier];
  if (!catalog) {
    throw new BadRequestError(`Unsupported plan tier: ${parsed.planTier}`);
  }

  const [existingVerif] = await db
    .select({ id: paymentVerifications.id })
    .from(paymentVerifications)
    .where(eq(paymentVerifications.transactionReference, parsed.txSignature))
    .limit(1);

  if (existingVerif) {
    throw new ConflictError("This Solana transaction signature has already been redeemed.");
  }

  const expectedMicros = BigInt(Math.round(catalog.usdcAmount * 1_000_000));
  const verification = await verifyUsdcTransferTransaction({
    signature: parsed.txSignature,
    payerWallet,
    expectedMicros,
  });

  let orderId = parsed.orderId;
  if (orderId) {
    await db
      .update(paymentOrders)
      .set({ status: "verified", updatedAt: new Date() })
      .where(eq(paymentOrders.id, orderId));
  } else {
    const orderRef = `USDC-${Date.now().toString(36).toUpperCase()}`;
    const [created] = await db
      .insert(paymentOrders)
      .values({
        userId: session.user.id,
        planId: catalog.planId,
        amountEtb: catalog.usdcAmount,
        currency: "USDC",
        orderReference: orderRef,
        expectedReceiver: verification.treasuryWallet,
        status: "verified",
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })
      .returning();
    orderId = created.id;
  }

  await db.insert(paymentVerifications).values({
    orderId,
    providerRequestId: parsed.txSignature,
    transactionReference: parsed.txSignature,
    verifiedAmount: catalog.usdcAmount,
    verifiedCurrency: "USDC",
    status: "verified",
    responseMetadata: {
      payerWallet,
      treasuryWallet: verification.treasuryWallet,
      treasuryAta: verification.treasuryAta,
      receivedMicros: verification.receivedMicros,
    },
  });

  const subscription = await upgradeUserSubscriptionTier({
    userId: session.user.id,
    planTier: catalog.tier,
  });

  return successResponse({
    verified: true,
    orderId,
    planTier: catalog.tier,
    amountUsdc: catalog.usdcAmount,
    txSignature: parsed.txSignature,
    txUrl: getExplorerTxUrl(parsed.txSignature),
    subscription,
  });
});

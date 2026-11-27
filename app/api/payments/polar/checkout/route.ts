import { requireAuth } from "@/lib/auth/session";
import { executePolarCall, getPolarProductIdForTier } from "@/lib/payments/polar-client";
import { successResponse, errorResponse } from "@/lib/shared";
import { BadRequestError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireAuth(req.headers);
    const body = await req.json().catch(() => ({}));
    const planTier: string = body.planTier || "pro_monthly";

    const productId = body.productId || getPolarProductIdForTier(planTier);
    if (!productId) {
      throw new BadRequestError(
        `Polar Product ID is not configured for plan tier: ${planTier}. Set POLAR_PRODUCT_ID_${planTier.toUpperCase()} in your environment.`
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const checkout = await executePolarCall(async (polar) => {
      const checkoutParams: Parameters<typeof polar.checkouts.create>[0] = {
        products: [productId],
        external_customer_id: session.user.id,
        customer_email: session.user.email || undefined,
        metadata: {
          userId: session.user.id,
          planTier,
        },
        success_url: `${appUrl}/billing?success=true&tier=${encodeURIComponent(planTier)}&checkout_id={CHECKOUT_ID}`,
        return_url: `${appUrl}/billing`,
      };

      // Pass customerExternalId as well to satisfy Polar SDK / API variants
      (checkoutParams as unknown as Record<string, unknown>).customerExternalId = session.user.id;

      return polar.checkouts.create(checkoutParams);
    });

    logger.info("Created Polar checkout session", {
      userId: session.user.id,
      planTier,
      productId,
      checkoutId: checkout.id,
      checkoutUrl: checkout.url,
    });

    return successResponse({
      checkoutUrl: checkout.url,
      url: checkout.url,
      id: checkout.id,
    });
  } catch (err) {
    logger.error("Failed to create Polar checkout session", { err });
    return errorResponse(err);
  }
}

import { requireAuth } from "@/lib/auth/session";
import { executePolarCall } from "@/lib/payments/polar-client";
import { successResponse, errorResponse } from "@/lib/shared";
import { logger } from "@/lib/shared/logger";

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireAuth(req.headers);

    const customerSession = await executePolarCall(async (polar) => {
      try {
        return await polar.customerSessions.create({
          external_customer_id: session.user.id,
        });
      } catch (sessionErr: unknown) {
        const isNotFoundOrValidation =
          Boolean(sessionErr) &&
          typeof sessionErr === "object" &&
          (
            (sessionErr as { status?: number }).status === 422 ||
            (sessionErr as { statusCode?: number }).statusCode === 422 ||
            String((sessionErr as { message?: string }).message || "").includes("Customer does not exist")
          );

        if (isNotFoundOrValidation) {
          logger.info("Polar customer does not exist for session, attempting resolution", {
            userId: session.user.id,
          });

          // Check if customer already exists by email
          if (session.user.email) {
            try {
              const listRes = await polar.customers.list();
              const existingCustomer = listRes.items?.find(
                (c) => Boolean(c.email) && c.email!.toLowerCase() === session.user.email.toLowerCase()
              );

              if (existingCustomer) {
                return await polar.customerSessions.create({
                  customer_id: existingCustomer.id,
                });
              }
            } catch {
              // Non-blocking fallback to customer creation
            }
          }

          // Provision customer in Polar
          try {
            const newCustomer = await polar.customers.create({
              external_id: session.user.id,
              email: session.user.email || `${session.user.id}@cookmycv.local`,
              name: session.user.name || "Customer",
            });
            return await polar.customerSessions.create({
              customer_id: newCustomer.id,
            });
          } catch {
            return await polar.customerSessions.create({
              external_customer_id: session.user.id,
            });
          }
        }
        throw sessionErr;
      }
    });

    logger.info("Created Polar customer portal session", {
      userId: session.user.id,
      portalUrl: customerSession.customer_portal_url,
    });

    return successResponse({
      portalUrl: customerSession.customer_portal_url,
      url: customerSession.customer_portal_url,
    });
  } catch (err) {
    logger.error("Failed to create Polar customer portal session", { err });
    return errorResponse(err);
  }
}

export async function GET(req: Request): Promise<Response> {
  return POST(req);
}

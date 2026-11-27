import { randomUUID } from "node:crypto";
import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { db, users, subscriptions } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { ForbiddenError, BadRequestError } from "@/lib/shared/errors";
import { z } from "zod";
import { logger } from "@/lib/shared/logger";

const SUPER_ADMIN_EMAIL = "israelashenafi29@gmail.com";

const GrantSubscriptionSchema = z.object({
  email: z.string().email("Please provide a valid email address"),
  planTier: z.enum([
    "pro_monthly",
    "pro_plus_monthly",
    "pro_yearly",
    "pro_plus_yearly",
    "unlimited_yearly",
  ]),
});

const PLAN_NAMES: Record<string, string> = {
  pro_monthly: "Pro Monthly",
  pro_plus_monthly: "Pro Plus Monthly",
  pro_yearly: "Pro Yearly",
  pro_plus_yearly: "Pro Plus Yearly",
  unlimited_yearly: "Unlimited Yearly",
};

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const userEmail = (session.user.email || "").toLowerCase().trim();

  if (userEmail !== SUPER_ADMIN_EMAIL) {
    logger.warn("Unauthorized attempt to access grant-subscription endpoint", {
      attemptedBy: session.user.email,
      userId: session.user.id,
    });
    throw new ForbiddenError("Access restricted. Only israelashenafi29@gmail.com can grant subscriptions.");
  }

  const body = await req.json();
  const input = GrantSubscriptionSchema.parse(body);
  const targetEmail = input.email.toLowerCase().trim();

  // 1. Locate or create target user
  let [targetUser] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, targetEmail))
    .limit(1);

  if (!targetUser) {
    const newUserId = `user_${randomUUID()}`;
    const [inserted] = await db
      .insert(users)
      .values({
        id: newUserId,
        email: targetEmail,
        name: targetEmail.split("@")[0],
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
      });
    targetUser = inserted;
  }

  if (!targetUser) {
    throw new BadRequestError("Failed to initialize account for target email");
  }

  // 2. Compute subscription period and mapped database plan ID
  const dbPlanId = input.planTier.startsWith("plan_") ? input.planTier : `plan_${input.planTier}`;
  const durationDays = input.planTier.includes("yearly") ? 365 : 30;
  const now = new Date();
  let currentPeriodStart = now;
  let currentPeriodEnd = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const existingSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, targetUser.id))
    .limit(1);

  if (existingSubs.length > 0) {
    const cur = existingSubs[0];
    if (cur.status === "active" && cur.currentPeriodEnd > now) {
      // Extend existing subscription
      currentPeriodStart = cur.currentPeriodStart;
      currentPeriodEnd = new Date(cur.currentPeriodEnd.getTime() + durationDays * 24 * 60 * 60 * 1000);
    }

    await db
      .update(subscriptions)
      .set({
        planId: dbPlanId,
        status: "active",
        currentPeriodStart,
        currentPeriodEnd,
        renewalDate: currentPeriodEnd,
        updatedAt: now,
      })
      .where(eq(subscriptions.userId, targetUser.id));
  } else {
    await db.insert(subscriptions).values({
      userId: targetUser.id,
      planId: dbPlanId,
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
      renewalDate: currentPeriodEnd,
    });
  }

  const planName = PLAN_NAMES[input.planTier] || input.planTier;
  const successMessage = `Successfully gave a ${planName} sub for "${targetEmail}"`;

  logger.info("Admin granted subscription reward", {
    grantedBy: userEmail,
    grantedTo: targetEmail,
    planTier: input.planTier,
    currentPeriodEnd: currentPeriodEnd.toISOString(),
  });

  return successResponse({
    email: targetEmail,
    planTier: input.planTier,
    planName,
    expiresAt: currentPeriodEnd,
    message: successMessage,
  });
});

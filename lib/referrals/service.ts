import { db, referrals, users } from "@/lib/db";
import { eq, count, or } from "drizzle-orm";
import { logger } from "@/lib/shared/logger";
import { recordAuditEvent } from "@/lib/operations/audit";

/**
 * Records a referral when a referred user signs up via an existing user's referral link.
 * Awards 1 free review credit to the referrer.
 */
export async function recordReferral(params: {
  referrerId: string;
  referredUserId: string;
}): Promise<{ success: boolean; bonusGranted: boolean; message: string }> {
  const { referrerId, referredUserId } = params;

  if (!referrerId || !referredUserId) {
    return { success: false, bonusGranted: false, message: "Missing referrer or referred user id." };
  }

  try {
    // Verify referrer exists by ID or email
    const cleanRef = referrerId.trim();
    const [referrer] = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, cleanRef), eq(users.email, cleanRef.toLowerCase())))
      .limit(1);

    if (!referrer) {
      return { success: false, bonusGranted: false, message: "Referrer does not exist." };
    }

    const actualReferrerId = referrer.id;

    // A user cannot refer themselves
    if (actualReferrerId === referredUserId) {
      return { success: false, bonusGranted: false, message: "Users cannot refer their own account." };
    }

    // Verify referred user has not already been referred
    const [existing] = await db
      .select({ id: referrals.id })
      .from(referrals)
      .where(eq(referrals.referredUserId, referredUserId))
      .limit(1);

    if (existing) {
      return { success: false, bonusGranted: false, message: "User was already referred." };
    }

    // Insert referral record
    await db.insert(referrals).values({
      referrerId: actualReferrerId,
      referredUserId,
    });

    await recordAuditEvent({
      userId: actualReferrerId,
      action: "referral.credited",
      targetId: referredUserId,
      targetType: "referral",
      metadata: {
        bonusReviewsEarned: 1,
      },
    });

    logger.info("Referral successfully recorded", { referrerId: actualReferrerId, referredUserId });
    return { success: true, bonusGranted: true, message: "Referral recorded. +1 free review credited!" };
  } catch (err) {
    logger.error("Failed to record referral", {
      referrerId,
      referredUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, bonusGranted: false, message: "Failed to record referral." };
  }
}

/**
 * Calculates total bonus review credits earned by a user through referrals.
 * 1 referred person = 1 free review.
 */
export async function getReferralBonusCredits(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    const [result] = await db
      .select({ total: count() })
      .from(referrals)
      .where(eq(referrals.referrerId, userId));

    return Number(result?.total ?? 0);
  } catch (err) {
    logger.warn("Failed to query referral bonus credits", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * Retrieves full referral statistics and invite link for a user.
 */
export async function getReferralStats(userId: string): Promise<{
  referralCount: number;
  bonusReviews: number;
  referralLink: string;
}> {
  const bonus = await getReferralBonusCredits(userId);
  const referralLink = `https://coov.space/auth?ref=${userId}`;

  return {
    referralCount: bonus,
    bonusReviews: bonus,
    referralLink,
  };
}

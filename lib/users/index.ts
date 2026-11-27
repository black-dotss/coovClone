import { db, userProfiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { UserProfile } from "./types";

export * from "./types";

/**
 * Retrieves the profile for a given user ID.
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));

  if (!profile) return null;

  return {
    id: profile.id,
    userId: profile.userId,
    displayName: profile.displayName,
    timezone: profile.timezone,
    accountStatus: profile.accountStatus as "active" | "suspended" | "pending_deletion",
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

/**
 * Creates an initial user profile for a newly registered user.
 */
export async function createUserProfile(data: {
  userId: string;
  displayName: string;
  timezone?: string;
}): Promise<UserProfile> {
  const [created] = await db
    .insert(userProfiles)
    .values({
      userId: data.userId,
      displayName: data.displayName,
      timezone: data.timezone ?? "Africa/Addis_Ababa",
      accountStatus: "active",
    })
    .returning();

  return {
    id: created.id,
    userId: created.userId,
    displayName: created.displayName,
    timezone: created.timezone,
    accountStatus: created.accountStatus as "active" | "suspended" | "pending_deletion",
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

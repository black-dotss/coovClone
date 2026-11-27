import { db } from "@/lib/db";
import {
  users,
  userProfiles,
  subscriptions,
  plans,
  usageCounters,
  devices,
  deviceTrialClaims,
  deviceTombstones,
  deviceEvents,
  evaluations,
  paymentOrders,
  auditEvents,
} from "@/lib/db/schema";
import { eq, desc, or, and, sql, count, inArray } from "drizzle-orm";
import { recordAuditEvent } from "./audit";
import { logger } from "@/lib/shared/logger";
import { NotFoundError, BadRequestError } from "@/lib/shared/errors";
import { assertAdmin } from "./admin";

export interface AdminUserContext {
  id: string;
  role?: string;
  email?: string;
}

export interface CrmOverviewMetrics {
  totalUsers: number;
  totalActiveSubscriptions: number;
  totalEvaluations: number;
  completedEvaluations: number;
  failedEvaluations: number;
  processingEvaluations: number;
  totalDevices: number;
  activeDevices: number;
  ambiguousPayments: number;
  recentAuditEvents: Array<{
    id: string;
    userId: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    createdAt: Date;
    metadata: Record<string, unknown> | null;
  }>;
}

export interface CrmUserItem {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  accountStatus: string;
  subscription: {
    planId: string | null;
    planName: string | null;
    status: string | null;
    currentPeriodEnd: Date | null;
  } | null;
  evaluationsCount: number;
  devicesCount: number;
  usage: {
    evaluationsUsed: number;
    evaluationsReserved: number;
  } | null;
}

export interface CrmDeviceItem {
  id: string;
  deviceId: string;
  ownerUserId: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
  label?: string | null;
  status: string;
  trialClaimedAt?: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  isTombstoned: boolean;
}

export interface CrmEvaluationItem {
  id: string;
  ownerUserId: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
  tone: string;
  status: string;
  overallScore: number | null;
  verdict: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 1. Overview & High-level Metrics for the CRM Dashboard
 */
export async function getCrmOverview(adminUser: AdminUserContext): Promise<CrmOverviewMetrics> {
  assertAdmin(adminUser);

  const [usersCountResult] = await db.select({ value: count() }).from(users);
  const [activeSubsResult] = await db
    .select({ value: count() })
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));

  const [totalEvalsResult] = await db.select({ value: count() }).from(evaluations);
  const [completedEvalsResult] = await db
    .select({ value: count() })
    .from(evaluations)
    .where(eq(evaluations.status, "completed"));
  const [failedEvalsResult] = await db
    .select({ value: count() })
    .from(evaluations)
    .where(eq(evaluations.status, "failed"));
  const [processingEvalsResult] = await db
    .select({ value: count() })
    .from(evaluations)
    .where(or(eq(evaluations.status, "processing"), eq(evaluations.status, "queued")));

  const [totalDevicesResult] = await db.select({ value: count() }).from(devices);
  const [activeDevicesResult] = await db
    .select({ value: count() })
    .from(devices)
    .where(eq(devices.status, "active"));

  const [ambiguousPaymentsResult] = await db
    .select({ value: count() })
    .from(paymentOrders)
    .where(eq(paymentOrders.status, "ambiguous"));

  const recentAudit = await db
    .select({
      id: auditEvents.id,
      userId: auditEvents.userId,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      createdAt: auditEvents.createdAt,
      metadata: auditEvents.metadata,
    })
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt))
    .limit(12);

  return {
    totalUsers: usersCountResult?.value ?? 0,
    totalActiveSubscriptions: activeSubsResult?.value ?? 0,
    totalEvaluations: totalEvalsResult?.value ?? 0,
    completedEvaluations: completedEvalsResult?.value ?? 0,
    failedEvaluations: failedEvalsResult?.value ?? 0,
    processingEvaluations: processingEvalsResult?.value ?? 0,
    totalDevices: totalDevicesResult?.value ?? 0,
    activeDevices: activeDevicesResult?.value ?? 0,
    ambiguousPayments: ambiguousPaymentsResult?.value ?? 0,
    recentAuditEvents: recentAudit.map((a) => ({
      ...a,
      metadata: (a.metadata as Record<string, unknown>) ?? null,
    })),
  };
}

/**
 * 2. Search & List Users with Plan, Usage, and Device Counts
 */
export async function listCrmUsers(
  params: { search?: string; page?: number; limit?: number },
  adminUser: AdminUserContext
): Promise<{ users: CrmUserItem[]; totalCount: number; page: number; totalPages: number }> {
  assertAdmin(adminUser);

  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const offset = (page - 1) * limit;

  const search = params.search?.trim().toLowerCase();
  const whereClause = search
    ? or(sql`lower(${users.email}) LIKE ${`%${search}%`}`, sql`lower(${users.name}) LIKE ${`%${search}%`}`)
    : undefined;

  const [totalCountResult] = await db
    .select({ value: count() })
    .from(users)
    .where(whereClause);

  const totalCount = totalCountResult?.value ?? 0;

  const usersList = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  if (usersList.length === 0) {
    return { users: [], totalCount: 0, page, totalPages: 0 };
  }

  const userIds = usersList.map((u) => u.id);

  // Fetch profiles
  const profiles = await db
    .select({
      userId: userProfiles.userId,
      accountStatus: userProfiles.accountStatus,
    })
    .from(userProfiles)
    .where(inArray(userProfiles.userId, userIds));

  const profileMap = new Map(profiles.map((p) => [p.userId, p.accountStatus]));

  // Fetch active subscriptions with plan details
  const subs = await db
    .select({
      userId: subscriptions.userId,
      planId: subscriptions.planId,
      planName: plans.name,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .leftJoin(plans, eq(subscriptions.planId, plans.id))
    .where(and(inArray(subscriptions.userId, userIds), eq(subscriptions.status, "active")));

  const subMap = new Map(subs.map((s) => [s.userId, s]));

  // Fetch evaluation counts
  const evalCounts = await db
    .select({
      userId: evaluations.ownerUserId,
      count: count(),
    })
    .from(evaluations)
    .where(inArray(evaluations.ownerUserId, userIds))
    .groupBy(evaluations.ownerUserId);

  const evalCountMap = new Map(evalCounts.map((e) => [e.userId, e.count]));

  // Fetch device counts
  const devCounts = await db
    .select({
      userId: devices.ownerUserId,
      count: count(),
    })
    .from(devices)
    .where(inArray(devices.ownerUserId, userIds))
    .groupBy(devices.ownerUserId);

  const devCountMap = new Map(devCounts.map((d) => [d.userId, d.count]));

  // Fetch usage counters
  const usages = await db
    .select({
      userId: usageCounters.userId,
      evaluationsUsed: usageCounters.evaluationsUsed,
      evaluationsReserved: usageCounters.evaluationsReserved,
    })
    .from(usageCounters)
    .where(inArray(usageCounters.userId, userIds));

  const usageMap = new Map(usages.map((u) => [u.userId, u]));

  const mappedUsers: CrmUserItem[] = usersList.map((u) => {
    const sub = subMap.get(u.id);
    const usage = usageMap.get(u.id);

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
      accountStatus: profileMap.get(u.id) || "active",
      subscription: sub
        ? {
            planId: sub.planId,
            planName: sub.planName,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
      evaluationsCount: evalCountMap.get(u.id) || 0,
      devicesCount: devCountMap.get(u.id) || 0,
      usage: usage
        ? {
            evaluationsUsed: usage.evaluationsUsed,
            evaluationsReserved: usage.evaluationsReserved,
          }
        : null,
    };
  });

  return {
    users: mappedUsers,
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit) || 1,
  };
}

/**
 * 3. Inspect Single User Details in CRM
 */
export async function getCrmUserDetail(userId: string, adminUser: AdminUserContext) {
  assertAdmin(adminUser);

  const [userRecord] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRecord) {
    throw new NotFoundError(`User with ID "${userId}" not found.`);
  }

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const userSubs = await db
    .select({
      id: subscriptions.id,
      planId: subscriptions.planId,
      planName: plans.name,
      status: subscriptions.status,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .leftJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt));

  const userDevices = await db
    .select()
    .from(devices)
    .where(eq(devices.ownerUserId, userId))
    .orderBy(desc(devices.lastSeenAt));

  const userEvals = await db
    .select({
      id: evaluations.id,
      tone: evaluations.tone,
      status: evaluations.status,
      overallScore: evaluations.overallScore,
      verdict: evaluations.verdict,
      errorMessage: evaluations.errorMessage,
      createdAt: evaluations.createdAt,
    })
    .from(evaluations)
    .where(eq(evaluations.ownerUserId, userId))
    .orderBy(desc(evaluations.createdAt))
    .limit(20);

  const [usage] = await db
    .select()
    .from(usageCounters)
    .where(eq(usageCounters.userId, userId))
    .limit(1);

  const devEvents = await db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.userId, userId))
    .orderBy(desc(deviceEvents.createdAt))
    .limit(15);

  return {
    user: userRecord,
    profile: profile || {
      userId,
      displayName: userRecord.name,
      accountStatus: "active",
      timezone: "Africa/Addis_Ababa",
    },
    subscriptions: userSubs,
    devices: userDevices,
    evaluations: userEvals,
    usage: usage || {
      evaluationsUsed: 0,
      evaluationsReserved: 0,
    },
    deviceEvents: devEvents,
  };
}

/**
 * 4. Update User Account Status (active / suspended)
 */
export async function updateUserAccountStatus(
  userId: string,
  status: "active" | "suspended",
  adminUser: AdminUserContext
) {
  assertAdmin(adminUser);

  const [existingUser] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!existingUser) {
    throw new NotFoundError(`User with ID "${userId}" not found.`);
  }

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  if (profile) {
    await db
      .update(userProfiles)
      .set({
        accountStatus: status,
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, userId));
  } else {
    await db.insert(userProfiles).values({
      userId,
      displayName: existingUser.email,
      accountStatus: status,
    });
  }

  await recordAuditEvent({
    userId: adminUser.id,
    action: "admin.user_status_updated",
    targetType: "user",
    targetId: userId,
    metadata: { newStatus: status, targetEmail: existingUser.email },
  });

  logger.info("Admin updated user account status", {
    userId,
    newStatus: status,
    adminId: adminUser.id,
  });

  return { success: true, userId, status };
}

/**
 * 5. Reset User Evaluation Usage Counter
 */
export async function resetUserEvaluationUsage(userId: string, adminUser: AdminUserContext) {
  assertAdmin(adminUser);

  await db
    .update(usageCounters)
    .set({
      evaluationsUsed: 0,
      evaluationsReserved: 0,
      updatedAt: new Date(),
    })
    .where(eq(usageCounters.userId, userId));

  await recordAuditEvent({
    userId: adminUser.id,
    action: "admin.user_usage_reset",
    targetType: "user",
    targetId: userId,
  });

  logger.info("Admin reset usage counter for user", { userId, adminId: adminUser.id });

  return {
    success: true,
    userId,
    message: "Evaluation usage quota has been successfully reset to 0.",
  };
}

/**
 * 6. List Registered Devices Across the Platform
 */
export async function listCrmDevices(
  params: { search?: string; status?: string; page?: number; limit?: number },
  adminUser: AdminUserContext
): Promise<{ devices: CrmDeviceItem[]; totalCount: number; page: number; totalPages: number }> {
  assertAdmin(adminUser);

  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 30));
  const offset = (page - 1) * limit;

  const search = params.search?.trim().toLowerCase();
  const statusFilter = params.status && params.status !== "all" ? params.status : undefined;

  let whereConditions = statusFilter ? eq(devices.status, statusFilter) : undefined;

  if (search) {
    const searchCondition = or(
      sql`lower(${devices.deviceId}) LIKE ${`%${search}%`}`,
      sql`lower(${devices.label}) LIKE ${`%${search}%`}`,
      sql`lower(${users.email}) LIKE ${`%${search}%`}`,
      sql`lower(${users.name}) LIKE ${`%${search}%`}`
    );
    whereConditions = whereConditions ? and(whereConditions, searchCondition) : searchCondition;
  }

  const [totalCountResult] = await db
    .select({ value: count() })
    .from(devices)
    .leftJoin(users, eq(devices.ownerUserId, users.id))
    .where(whereConditions);

  const totalCount = totalCountResult?.value ?? 0;

  const devList = await db
    .select({
      id: devices.id,
      deviceId: devices.deviceId,
      ownerUserId: devices.ownerUserId,
      ownerEmail: users.email,
      ownerName: users.name,
      label: devices.label,
      status: devices.status,
      trialClaimedAt: devices.trialClaimedAt,
      firstSeenAt: devices.firstSeenAt,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .leftJoin(users, eq(devices.ownerUserId, users.id))
    .where(whereConditions)
    .orderBy(desc(devices.lastSeenAt))
    .limit(limit)
    .offset(offset);

  const deviceIds = devList.map((d) => d.deviceId);
  let tombstonedSet = new Set<string>();

  if (deviceIds.length > 0) {
    const tombstones = await db
      .select({ deviceId: deviceTombstones.deviceId })
      .from(deviceTombstones)
      .where(inArray(deviceTombstones.deviceId, deviceIds));
    tombstonedSet = new Set(tombstones.map((t) => t.deviceId));
  }

  const mappedDevices: CrmDeviceItem[] = devList.map((d) => ({
    ...d,
    isTombstoned: tombstonedSet.has(d.deviceId),
  }));

  return {
    devices: mappedDevices,
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit) || 1,
  };
}

/**
 * 7. Free Device / Bypass One-Device-One-Account Enforcement
 * Allows Admin to unlink a single device or all devices belonging to a user email.
 * Clears devices table, trial claims, and tombstones so the user can register or sign in.
 */
export async function freeDevice(
  params: { deviceId?: string; userEmail?: string },
  adminUser: AdminUserContext
): Promise<{
  success: boolean;
  freedCount: number;
  clearedClaims: number;
  clearedTombstones: number;
  deviceIds: string[];
  message: string;
}> {
  assertAdmin(adminUser);

  if (!params.deviceId && !params.userEmail) {
    throw new BadRequestError("Please specify either a deviceId or userEmail to free.");
  }

  let targetDeviceIds: string[] = [];
  let targetUserId: string | null = null;
  let targetEmail: string | null = null;

  if (params.userEmail) {
    targetEmail = params.userEmail.trim().toLowerCase();
    const [foundUser] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(sql`lower(${users.email})`, targetEmail))
      .limit(1);

    if (foundUser) {
      targetUserId = foundUser.id;
      const userDevices = await db
        .select({ deviceId: devices.deviceId })
        .from(devices)
        .where(eq(devices.ownerUserId, foundUser.id));

      targetDeviceIds = userDevices.map((d) => d.deviceId);

      const userClaims = await db
        .select({ deviceId: deviceTrialClaims.deviceId })
        .from(deviceTrialClaims)
        .where(eq(deviceTrialClaims.userId, foundUser.id));

      for (const claim of userClaims) {
        if (!targetDeviceIds.includes(claim.deviceId)) {
          targetDeviceIds.push(claim.deviceId);
        }
      }
    } else {
      logger.warn("Admin attempted to free device by non-existent user email", { targetEmail });
    }
  }

  if (params.deviceId) {
    const devId = params.deviceId.trim();
    if (!targetDeviceIds.includes(devId)) {
      targetDeviceIds.push(devId);
    }
  }

  if (targetDeviceIds.length === 0 && !targetUserId) {
    throw new NotFoundError(
      params.userEmail
        ? `No devices found associated with account "${params.userEmail}".`
        : `Device "${params.deviceId}" not found.`
    );
  }

  let freedDevices = 0;
  let clearedClaims = 0;
  let clearedTombstones = 0;

  // 1. Delete from devices table
  if (targetDeviceIds.length > 0) {
    const deletedDevs = await db
      .delete(devices)
      .where(inArray(devices.deviceId, targetDeviceIds))
      .returning({ id: devices.id });
    freedDevices = deletedDevs.length;
  } else if (targetUserId) {
    const deletedDevs = await db
      .delete(devices)
      .where(eq(devices.ownerUserId, targetUserId))
      .returning({ id: devices.id });
    freedDevices = deletedDevs.length;
  }

  // 2. Delete from device trial claims
  if (targetDeviceIds.length > 0) {
    const deletedClaims = await db
      .delete(deviceTrialClaims)
      .where(inArray(deviceTrialClaims.deviceId, targetDeviceIds))
      .returning({ id: deviceTrialClaims.id });
    clearedClaims = deletedClaims.length;
  }
  if (targetUserId) {
    const userClaims = await db
      .delete(deviceTrialClaims)
      .where(eq(deviceTrialClaims.userId, targetUserId))
      .returning({ id: deviceTrialClaims.id });
    clearedClaims += userClaims.length;
  }

  // 3. Delete from device tombstones
  if (targetDeviceIds.length > 0) {
    const deletedTombstones = await db
      .delete(deviceTombstones)
      .where(inArray(deviceTombstones.deviceId, targetDeviceIds))
      .returning({ id: deviceTombstones.id });
    clearedTombstones = deletedTombstones.length;
  }

  // 4. Log device events
  for (const devId of targetDeviceIds) {
    try {
      await db.insert(deviceEvents).values({
        deviceId: devId,
        userId: targetUserId || adminUser.id,
        eventType: "admin_freed",
        riskOutcome: "allowed",
        metadata: {
          freedByAdminId: adminUser.id,
          targetEmail: targetEmail || "direct_device_id",
        },
      });
    } catch {
      // Ignore non-critical event log insertion failure
    }
  }

  // 5. Record audit event
  await recordAuditEvent({
    userId: adminUser.id,
    action: "admin.device_freed",
    targetType: "device",
    targetId: targetDeviceIds.join(",") || targetUserId || "all",
    metadata: {
      targetEmail,
      deviceIds: targetDeviceIds,
      freedDevices,
      clearedClaims,
      clearedTombstones,
    },
  });

  logger.info("Admin freed device restrictions", {
    adminId: adminUser.id,
    targetEmail,
    deviceIds: targetDeviceIds,
    freedDevices,
    clearedClaims,
    clearedTombstones,
  });

  const identifier = targetEmail || targetDeviceIds.join(", ");
  const message = `Successfully freed ${freedDevices} registered device(s), cleared ${clearedClaims} trial claim(s), and removed ${clearedTombstones} tombstone(s) for ${identifier}. The device is now unblocked and ready for immediate login or registration.`;

  return {
    success: true,
    freedCount: freedDevices,
    clearedClaims,
    clearedTombstones,
    deviceIds: targetDeviceIds,
    message,
  };
}

/**
 * 8. Toggle Device Active/Revoked Status
 */
export async function toggleDeviceStatus(
  deviceId: string,
  status: "active" | "revoked",
  adminUser: AdminUserContext
) {
  assertAdmin(adminUser);

  const [existing] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.deviceId, deviceId))
    .limit(1);

  if (!existing) {
    throw new NotFoundError(`Device with ID "${deviceId}" not found.`);
  }

  await db
    .update(devices)
    .set({
      status,
      revokedAt: status === "revoked" ? new Date() : null,
    })
    .where(eq(devices.deviceId, deviceId));

  await recordAuditEvent({
    userId: adminUser.id,
    action: "admin.device_status_updated",
    targetType: "device",
    targetId: deviceId,
    metadata: { newStatus: status },
  });

  return { success: true, deviceId, status };
}

/**
 * 9. List Platform Evaluations in CRM
 */
export async function listCrmEvaluations(
  params: { status?: string; search?: string; page?: number; limit?: number },
  adminUser: AdminUserContext
): Promise<{ evaluations: CrmEvaluationItem[]; totalCount: number; page: number; totalPages: number }> {
  assertAdmin(adminUser);

  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 25));
  const offset = (page - 1) * limit;

  const search = params.search?.trim().toLowerCase();
  const statusFilter = params.status && params.status !== "all" ? params.status : undefined;

  let whereConditions = statusFilter ? eq(evaluations.status, statusFilter) : undefined;

  if (search) {
    const searchCondition = or(
      sql`lower(${evaluations.id}::text) LIKE ${`%${search}%`}`,
      sql`lower(${users.email}) LIKE ${`%${search}%`}`,
      sql`lower(${users.name}) LIKE ${`%${search}%`}`,
      sql`lower(${evaluations.verdict}) LIKE ${`%${search}%`}`
    );
    whereConditions = whereConditions ? and(whereConditions, searchCondition) : searchCondition;
  }

  const [totalCountResult] = await db
    .select({ value: count() })
    .from(evaluations)
    .leftJoin(users, eq(evaluations.ownerUserId, users.id))
    .where(whereConditions);

  const totalCount = totalCountResult?.value ?? 0;

  const evalsList = await db
    .select({
      id: evaluations.id,
      ownerUserId: evaluations.ownerUserId,
      ownerEmail: users.email,
      ownerName: users.name,
      tone: evaluations.tone,
      status: evaluations.status,
      overallScore: evaluations.overallScore,
      verdict: evaluations.verdict,
      errorMessage: evaluations.errorMessage,
      createdAt: evaluations.createdAt,
      updatedAt: evaluations.updatedAt,
    })
    .from(evaluations)
    .leftJoin(users, eq(evaluations.ownerUserId, users.id))
    .where(whereConditions)
    .orderBy(desc(evaluations.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    evaluations: evalsList,
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit) || 1,
  };
}

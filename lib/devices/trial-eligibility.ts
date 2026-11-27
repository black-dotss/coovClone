import { db } from "@/lib/db";
import { devices, deviceTrialClaims, deviceTombstones, usageCounters } from "@/lib/db/schema";
import { eq, and, desc, or } from "drizzle-orm";
import {
  verifyDeviceToken,
  verifyHardwareToken,
  hashDeviceToken,
} from "./tokens";
import {
  generateFingerprintHash,
  extractClientIp,
} from "./fingerprint";
import type {
  DeviceRecord,
  DeviceStatus,
  DeviceTrialClaimRecord,
  DeviceTrialEligibilityResult,
} from "./types";
import { recordDeviceEvent } from "./service";
import { recordAuditEvent } from "@/lib/operations/audit";

export interface CheckTrialEligibilityParams {
  userId: string;
  deviceId?: string;
  rawToken?: string | null;
  hardwareId?: string | null;
  rawHardwareToken?: string | null;
  trialAllowance?: number;
  ipAddress?: string | null;
  headers?: Headers;
}

export interface RecordTrialClaimParams {
  deviceId: string;
  hardwareId?: string;
  userId: string;
  ipAddress?: string | null;
  riskScore?: number;
  riskOutcome?: "allowed" | "flagged_for_review" | "blocked";
  metadata?: Record<string, unknown>;
}

function mapDeviceRow(record: typeof devices.$inferSelect): DeviceRecord {
  return {
    id: record.id,
    ownerUserId: record.ownerUserId,
    deviceId: record.deviceId,
    tokenHash: record.tokenHash,
    fingerprintHash: record.fingerprintHash,
    hardwareId: record.hardwareId ?? record.deviceId,
    label: record.label,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    status: record.status as DeviceStatus,
    trialClaimedAt: record.trialClaimedAt,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
  };
}

/**
 * Checks whether an incoming request from an account is eligible for a free-trial evaluation
 * using the combined (device + account) quota model:
 *
 * Rules:
 * 1. An active registered device owned by this user account is required.
 * 2. Multiple accounts may share the same physical device (`hardwareId`).
 * 3. Effective trial consumption is `Math.max(accountUsed, deviceUsed)`:
 *    - Switching to another account on the same device continues from the device's remaining count.
 *    - Opening an account on a new device continues from the account's remaining count.
 * 4. Deleting an account preserves `deviceUsed` via tombstones / non-cascading claims.
 * 5. Ambiguous fingerprint/IP signals trigger review logging, never hard blocks.
 */
export async function checkDeviceTrialEligibility(
  params: CheckTrialEligibilityParams
): Promise<DeviceTrialEligibilityResult> {
  const { userId, deviceId: paramDeviceId, rawToken, headers } = params;
  const trialAllowance = params.trialAllowance ?? 3;
  const ipAddress = params.ipAddress || (headers ? extractClientIp(headers) : null);
  const fingerprintHash = headers ? generateFingerprintHash(headers) : null;

  let resolvedHardwareId: string | null = params.hardwareId || null;
  if (!resolvedHardwareId && params.rawHardwareToken) {
    const hwRes = verifyHardwareToken(params.rawHardwareToken);
    if (hwRes.valid && hwRes.hardwareId) {
      resolvedHardwareId = hwRes.hardwareId;
    }
  }

  let targetDevice: DeviceRecord | null = null;
  let presentedOtherDevice: DeviceRecord | null = null;

  // 1a. Try from verified rawToken
  if (rawToken) {
    const verification = verifyDeviceToken(rawToken);
    if (verification.valid && verification.deviceId) {
      const tokenHash = hashDeviceToken(rawToken);
      const [record] = await db
        .select()
        .from(devices)
        .where(eq(devices.tokenHash, tokenHash))
        .limit(1);

      if (record) {
        const mapped = mapDeviceRow(record);
        resolvedHardwareId = resolvedHardwareId || mapped.hardwareId || mapped.deviceId;
        if (mapped.ownerUserId === userId) {
          targetDevice = mapped;
        } else {
          presentedOtherDevice = mapped;
        }
      }
    }
  }

  // 1b. Try from explicit deviceId parameter if still unresolved for this user
  if (!targetDevice && paramDeviceId) {
    const [record] = await db
      .select()
      .from(devices)
      .where(eq(devices.deviceId, paramDeviceId))
      .limit(1);

    if (record) {
      const mapped = mapDeviceRow(record);
      resolvedHardwareId = resolvedHardwareId || mapped.hardwareId || mapped.deviceId;
      if (mapped.ownerUserId === userId) {
        targetDevice = mapped;
      } else {
        presentedOtherDevice = presentedOtherDevice || mapped;
      }
    }
  }

  // 1c. Match user's device on this physical hardware (if known), or user's latest active device
  if (!targetDevice) {
    const userDevices = await db
      .select()
      .from(devices)
      .where(eq(devices.ownerUserId, userId))
      .orderBy(desc(devices.lastSeenAt));

    if (resolvedHardwareId) {
      const matchForHw = userDevices.find(
        (d) => (d.hardwareId || d.deviceId) === resolvedHardwareId
      );
      if (matchForHw) {
        targetDevice = mapDeviceRow(matchForHw);
      }
    }

    if (!targetDevice && !presentedOtherDevice) {
      const activeDev = userDevices.find((d) => d.status === "active");
      if (activeDev) {
        targetDevice = mapDeviceRow(activeDev);
        resolvedHardwareId =
          resolvedHardwareId || targetDevice.hardwareId || targetDevice.deviceId;
      }
    }
  }

  // Reject if a foreign device was presented directly and user has no registered device for it
  if (!targetDevice && presentedOtherDevice) {
    await recordDeviceEvent({
      deviceId: presentedOtherDevice.deviceId,
      userId,
      eventType: "trial.claim_rejected_unowned_device",
      riskOutcome: "blocked",
      metadata: { targetOwnerUserId: presentedOtherDevice.ownerUserId, ipAddress },
    });

    return {
      eligible: false,
      code: "DEVICE_NOT_OWNED",
      reason:
        "This device session is bound to another account. Sign in to register your session on this device.",
      riskScore: 100,
      riskOutcome: "blocked",
      device: presentedOtherDevice,
      claimedByUserId: presentedOtherDevice.ownerUserId,
    };
  }

  if (!targetDevice) {
    return {
      eligible: false,
      code: "DEVICE_NOT_REGISTERED",
      reason:
        "An active registered device is required to claim or use a free trial. Please register or verify your device.",
      riskScore: 50,
      riskOutcome: "blocked",
      device: null,
    };
  }

  // 2. Ownership & status check
  if (targetDevice.ownerUserId !== userId) {
    return {
      eligible: false,
      code: "DEVICE_NOT_OWNED",
      reason: "This device is registered to another account.",
      riskScore: 100,
      riskOutcome: "blocked",
      device: targetDevice,
      claimedByUserId: targetDevice.ownerUserId,
    };
  }

  if (targetDevice.status === "revoked") {
    return {
      eligible: false,
      code: "DEVICE_REVOKED",
      reason:
        "This device has been revoked. Re-activate or recover your device to access your account's evaluations.",
      riskScore: 40,
      riskOutcome: "blocked",
      device: targetDevice,
    };
  }

  const hardwareId =
    resolvedHardwareId || targetDevice.hardwareId || targetDevice.deviceId;

  // 3. Read Account Trial Counter
  const trialPeriodKey = `trial:${userId}`;
  const [trialCounter] = await db
    .select()
    .from(usageCounters)
    .where(
      and(eq(usageCounters.userId, userId), eq(usageCounters.periodKey, trialPeriodKey))
    )
    .limit(1);

  const accountUsed =
    (trialCounter?.evaluationsUsed ?? 0) + (trialCounter?.evaluationsReserved ?? 0);

  // 4. Read Shared Device/Hardware Trial Counter + Tombstone floor
  const [existingDeviceClaim] = await db
    .select()
    .from(deviceTrialClaims)
    .where(
      or(
        eq(deviceTrialClaims.deviceId, hardwareId),
        eq(deviceTrialClaims.hardwareId, hardwareId)
      )
    )
    .limit(1);

  let tombstoneUsed = 0;
  const tombstones = await db
    .select()
    .from(deviceTombstones)
    .where(
      or(
        eq(deviceTombstones.hardwareId, hardwareId),
        eq(deviceTombstones.deviceId, hardwareId),
        eq(deviceTombstones.deviceId, targetDevice.deviceId)
      )
    );

  for (const tomb of tombstones) {
    const val =
      typeof tomb.trialsUsed === "number" && tomb.trialsUsed > 0
        ? tomb.trialsUsed
        : tomb.trialConsumed
        ? 3
        : 0;
    if (val > tombstoneUsed) tombstoneUsed = val;
  }

  const claimCounted = existingDeviceClaim
    ? Math.max(
        (existingDeviceClaim.evaluationsUsed ?? 0) +
          (existingDeviceClaim.evaluationsReserved ?? 0),
        0
      )
    : 0;

  const deviceUsed = Math.max(claimCounted, tombstoneUsed);

  // 5. Combined Device + Account Usage Calculation
  const effectiveUsed = Math.max(accountUsed, deviceUsed);

  if (effectiveUsed >= trialAllowance) {
    const hitByDevice = deviceUsed >= trialAllowance && accountUsed < trialAllowance;
    return {
      eligible: false,
      code: hitByDevice ? "DEVICE_TRIAL_ALREADY_CLAIMED" : "TRIAL_LIMIT_EXCEEDED",
      reason: hitByDevice
        ? `Free trial limit reached (${trialAllowance} evaluations used on this device). Upgrade to Pro to continue.`
        : `Free trial limit reached (${trialAllowance} lifetime evaluations). Please upgrade to Pro to continue evaluating CVs.`,
      riskScore: hitByDevice ? 60 : 0,
      riskOutcome: "allowed",
      device: targetDevice,
      hardwareId,
      accountUsed,
      deviceUsed,
      effectiveUsed,
      deviceTrialClaimed: deviceUsed > 0,
      claimedByUserId: existingDeviceClaim?.userId ?? null,
    };
  }

  // 6. Ambiguous Fingerprint / Shared IP Risk Evaluation (logging only, never hard blocking)
  let riskScore = 0;
  let riskOutcome: "allowed" | "flagged_for_review" | "blocked" = "allowed";
  let riskReason: string | undefined;

  if (ipAddress) {
    const otherClaimsOnSameIp = await db
      .select({ id: deviceTrialClaims.id, userId: deviceTrialClaims.userId })
      .from(deviceTrialClaims)
      .where(eq(deviceTrialClaims.ipAddress, ipAddress))
      .limit(5);

    const hasOtherUserOnIp = otherClaimsOnSameIp.some(
      (c) => c.userId && c.userId !== userId
    );
    if (hasOtherUserOnIp) {
      riskScore = 30;
      riskOutcome = "flagged_for_review";
      riskReason = "shared_ip_address_detected";

      await recordDeviceEvent({
        deviceId: targetDevice.deviceId,
        userId,
        eventType: "trial.risk_review_flagged",
        riskOutcome: "flagged_for_review",
        metadata: {
          ipAddress,
          fingerprintHash,
          hardwareId,
          reason: "shared_ip_address_detected",
          claimCountOnIp: otherClaimsOnSameIp.length,
        },
      });
    }
  }

  return {
    eligible: true,
    riskScore,
    riskOutcome,
    riskReason,
    device: targetDevice,
    hardwareId,
    accountUsed,
    deviceUsed,
    effectiveUsed,
    deviceTrialClaimed: deviceUsed > 0,
    claimedByUserId: existingDeviceClaim?.userId ?? null,
  };
}

/**
 * Reserves 1 trial slot on the shared physical hardware record.
 */
export async function reserveDeviceTrialSlot(
  params: RecordTrialClaimParams & { initialUsedFloor?: number }
): Promise<DeviceTrialClaimRecord> {
  const {
    deviceId,
    userId,
    ipAddress,
    riskScore = 0,
    riskOutcome = "allowed",
    metadata = {},
    initialUsedFloor = 0,
  } = params;
  const hwId = params.hardwareId || deviceId;
  const now = new Date();

  const [existing] = await db
    .select()
    .from(deviceTrialClaims)
    .where(
      or(
        eq(deviceTrialClaims.deviceId, hwId),
        eq(deviceTrialClaims.hardwareId, hwId)
      )
    )
    .limit(1);

  let record: typeof deviceTrialClaims.$inferSelect;
  if (existing) {
    const [updated] = await db
      .update(deviceTrialClaims)
      .set({
        evaluationsUsed: existing.evaluationsUsed ?? 0,
        evaluationsReserved: (existing.evaluationsReserved ?? 0) + 1,
        hardwareId: hwId,
        ipAddress: ipAddress || existing.ipAddress,
      })
      .where(eq(deviceTrialClaims.id, existing.id))
      .returning();
    record = updated;
  } else {
    const [created] = await db
      .insert(deviceTrialClaims)
      .values({
        deviceId: hwId,
        hardwareId: hwId,
        userId,
        evaluationsUsed: initialUsedFloor,
        evaluationsReserved: 1,
        ipAddress: ipAddress || null,
        riskScore,
        riskOutcome,
        metadata,
        claimedAt: now,
        createdAt: now,
      })
      .returning();
    record = created;
  }

  await db
    .update(devices)
    .set({
      trialClaimedAt: now,
      lastSeenAt: now,
    })
    .where(or(eq(devices.deviceId, deviceId), eq(devices.hardwareId, hwId)));

  await recordAuditEvent({
    userId,
    action: "trial.claimed",
    targetId: hwId,
    targetType: "device_trial_claim",
    ipAddress: ipAddress || undefined,
    metadata: { riskScore, riskOutcome, hardwareId: hwId },
  });

  await recordDeviceEvent({
    deviceId,
    userId,
    eventType: "trial.claimed",
    riskOutcome,
    metadata: { ipAddress, riskScore, hardwareId: hwId },
  });

  return {
    id: record.id,
    deviceId: record.deviceId,
    hardwareId: record.hardwareId ?? hwId,
    userId: record.userId,
    evaluationsUsed: record.evaluationsUsed ?? 0,
    evaluationsReserved: record.evaluationsReserved ?? 0,
    claimedAt: record.claimedAt,
    ipAddress: record.ipAddress,
    riskScore: record.riskScore,
    riskOutcome: record.riskOutcome as "allowed" | "flagged_for_review" | "blocked",
    metadata: record.metadata,
    createdAt: record.createdAt,
  };
}

/**
 * Settles a reserved slot on the physical device upon evaluation completion.
 */
export async function settleDeviceTrialSlot(hardwareId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(deviceTrialClaims)
    .where(
      or(
        eq(deviceTrialClaims.deviceId, hardwareId),
        eq(deviceTrialClaims.hardwareId, hardwareId)
      )
    )
    .limit(1);

  if (!existing) return;

  await db
    .update(deviceTrialClaims)
    .set({
      evaluationsReserved: Math.max(0, (existing.evaluationsReserved ?? 0) - 1),
      evaluationsUsed: (existing.evaluationsUsed ?? 0) + 1,
    })
    .where(eq(deviceTrialClaims.id, existing.id));
}

/**
 * Releases a reserved slot on the physical device when an evaluation fails before completion.
 */
export async function releaseDeviceTrialSlot(hardwareId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(deviceTrialClaims)
    .where(
      or(
        eq(deviceTrialClaims.deviceId, hardwareId),
        eq(deviceTrialClaims.hardwareId, hardwareId)
      )
    )
    .limit(1);

  if (!existing) return;

  await db
    .update(deviceTrialClaims)
    .set({
      evaluationsReserved: Math.max(0, (existing.evaluationsReserved ?? 0) - 1),
    })
    .where(eq(deviceTrialClaims.id, existing.id));
}

/**
 * Records/increments a settled trial claim directly on a device (used in manual scripts/tests).
 */
export async function recordDeviceTrialClaim(
  params: RecordTrialClaimParams
): Promise<DeviceTrialClaimRecord> {
  const hwId = params.hardwareId || params.deviceId;
  const now = new Date();

  const [existing] = await db
    .select()
    .from(deviceTrialClaims)
    .where(
      or(
        eq(deviceTrialClaims.deviceId, hwId),
        eq(deviceTrialClaims.hardwareId, hwId)
      )
    )
    .limit(1);

  let record: typeof deviceTrialClaims.$inferSelect;
  if (existing) {
    const [updated] = await db
      .update(deviceTrialClaims)
      .set({
        evaluationsUsed: (existing.evaluationsUsed ?? 0) + 1,
      })
      .where(eq(deviceTrialClaims.id, existing.id))
      .returning();
    record = updated;
  } else {
    const [created] = await db
      .insert(deviceTrialClaims)
      .values({
        deviceId: hwId,
        hardwareId: hwId,
        userId: params.userId,
        evaluationsUsed: 1,
        evaluationsReserved: 0,
        ipAddress: params.ipAddress || null,
        riskScore: params.riskScore ?? 0,
        riskOutcome: params.riskOutcome ?? "allowed",
        metadata: params.metadata ?? {},
        claimedAt: now,
        createdAt: now,
      })
      .returning();
    record = created;
  }

  await db
    .update(devices)
    .set({
      trialClaimedAt: now,
      lastSeenAt: now,
    })
    .where(or(eq(devices.deviceId, params.deviceId), eq(devices.hardwareId, hwId)));

  return {
    id: record.id,
    deviceId: record.deviceId,
    hardwareId: record.hardwareId ?? hwId,
    userId: record.userId,
    evaluationsUsed: record.evaluationsUsed ?? 0,
    evaluationsReserved: record.evaluationsReserved ?? 0,
    claimedAt: record.claimedAt,
    ipAddress: record.ipAddress,
    riskScore: record.riskScore,
    riskOutcome: record.riskOutcome as "allowed" | "flagged_for_review" | "blocked",
    metadata: record.metadata,
    createdAt: record.createdAt,
  };
}

/**
 * Retrieves the trial claim record for a given deviceId or hardwareId.
 */
export async function getDeviceTrialClaim(
  deviceId: string
): Promise<DeviceTrialClaimRecord | null> {
  const [record] = await db
    .select()
    .from(deviceTrialClaims)
    .where(
      or(
        eq(deviceTrialClaims.deviceId, deviceId),
        eq(deviceTrialClaims.hardwareId, deviceId)
      )
    )
    .limit(1);

  if (!record) return null;

  return {
    id: record.id,
    deviceId: record.deviceId,
    hardwareId: record.hardwareId ?? record.deviceId,
    userId: record.userId,
    evaluationsUsed: record.evaluationsUsed ?? 0,
    evaluationsReserved: record.evaluationsReserved ?? 0,
    claimedAt: record.claimedAt,
    ipAddress: record.ipAddress,
    riskScore: record.riskScore,
    riskOutcome: record.riskOutcome as "allowed" | "flagged_for_review" | "blocked",
    metadata: record.metadata,
    createdAt: record.createdAt,
  };
}

/**
 * Retrieves the full trial history for an account.
 */
export async function getAccountTrialHistory(userId: string): Promise<{
  userId: string;
  evaluationsUsed: number;
  evaluationsReserved: number;
  remaining: number;
  limit: number;
  claims: DeviceTrialClaimRecord[];
}> {
  const trialPeriodKey = `trial:${userId}`;
  const [counter] = await db
    .select()
    .from(usageCounters)
    .where(
      and(eq(usageCounters.userId, userId), eq(usageCounters.periodKey, trialPeriodKey))
    )
    .limit(1);

  const used = counter?.evaluationsUsed ?? 0;
  const reserved = counter?.evaluationsReserved ?? 0;
  const limit = 3;
  const remaining = Math.max(0, limit - (used + reserved));

  const claimRecords = await db
    .select()
    .from(deviceTrialClaims)
    .where(eq(deviceTrialClaims.userId, userId))
    .orderBy(desc(deviceTrialClaims.claimedAt));

  const claims: DeviceTrialClaimRecord[] = claimRecords.map((c) => ({
    id: c.id,
    deviceId: c.deviceId,
    hardwareId: c.hardwareId ?? c.deviceId,
    userId: c.userId,
    evaluationsUsed: c.evaluationsUsed ?? 0,
    evaluationsReserved: c.evaluationsReserved ?? 0,
    claimedAt: c.claimedAt,
    ipAddress: c.ipAddress,
    riskScore: c.riskScore,
    riskOutcome: c.riskOutcome as "allowed" | "flagged_for_review" | "blocked",
    metadata: c.metadata,
    createdAt: c.createdAt,
  }));

  return {
    userId,
    evaluationsUsed: used,
    evaluationsReserved: reserved,
    remaining,
    limit,
    claims,
  };
}

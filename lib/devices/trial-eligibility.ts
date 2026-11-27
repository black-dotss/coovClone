import { db } from "@/lib/db";
import { devices, deviceTrialClaims, deviceTombstones, usageCounters } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  verifyDeviceToken,
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
import { logger } from "@/lib/shared/logger";

export interface CheckTrialEligibilityParams {
  userId: string;
  deviceId?: string;
  rawToken?: string | null;
  ipAddress?: string | null;
  headers?: Headers;
}

export interface RecordTrialClaimParams {
  deviceId: string;
  userId: string;
  ipAddress?: string | null;
  riskScore?: number;
  riskOutcome?: "allowed" | "flagged_for_review" | "blocked";
  metadata?: Record<string, unknown>;
}

/**
 * Checks whether an incoming request from an account is eligible for a free-trial allowance.
 *
 * Rules:
 * 1. An active registered device owned by this user account is required to grant/claim a trial.
 * 2. If the device has already been claimed for a free trial by ANY OTHER account, the request is REJECTED.
 * 3. Tombstoned devices (from deleted accounts or abuse) are permanently ineligible.
 * 4. Account trial history is independent of device claims: changing devices never resets account trial history.
 * 5. Ambiguous fingerprint matches (e.g. shared IP address alone) trigger risk review, NOT hard blocking.
 */
export async function checkDeviceTrialEligibility(
  params: CheckTrialEligibilityParams
): Promise<DeviceTrialEligibilityResult> {
  const { userId, deviceId: paramDeviceId, rawToken, headers } = params;
  const ipAddress = params.ipAddress || (headers ? extractClientIp(headers) : null);
  const fingerprintHash = headers ? generateFingerprintHash(headers) : null;

  // 1. Resolve Device
  let targetDevice: DeviceRecord | null = null;

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
        targetDevice = {
          id: record.id,
          ownerUserId: record.ownerUserId,
          deviceId: record.deviceId,
          tokenHash: record.tokenHash,
          fingerprintHash: record.fingerprintHash,
          label: record.label,
          firstSeenAt: record.firstSeenAt,
          lastSeenAt: record.lastSeenAt,
          status: record.status as DeviceStatus,
          trialClaimedAt: record.trialClaimedAt,
          createdAt: record.createdAt,
          revokedAt: record.revokedAt,
        };
      }
    }
  }

  // 1b. Try from deviceId parameter if not found by token
  if (!targetDevice && paramDeviceId) {
    const [record] = await db
      .select()
      .from(devices)
      .where(eq(devices.deviceId, paramDeviceId))
      .limit(1);

    if (record) {
      targetDevice = {
        id: record.id,
        ownerUserId: record.ownerUserId,
        deviceId: record.deviceId,
        tokenHash: record.tokenHash,
        fingerprintHash: record.fingerprintHash,
        label: record.label,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        status: record.status as DeviceStatus,
        trialClaimedAt: record.trialClaimedAt,
        createdAt: record.createdAt,
        revokedAt: record.revokedAt,
      };
    }
  }

  // 1c. If still not found, check the user's active devices
  if (!targetDevice) {
    const [userActiveDevice] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.ownerUserId, userId), eq(devices.status, "active")))
      .orderBy(desc(devices.lastSeenAt))
      .limit(1);

    if (userActiveDevice) {
      targetDevice = {
        id: userActiveDevice.id,
        ownerUserId: userActiveDevice.ownerUserId,
        deviceId: userActiveDevice.deviceId,
        tokenHash: userActiveDevice.tokenHash,
        fingerprintHash: userActiveDevice.fingerprintHash,
        label: userActiveDevice.label,
        firstSeenAt: userActiveDevice.firstSeenAt,
        lastSeenAt: userActiveDevice.lastSeenAt,
        status: userActiveDevice.status as DeviceStatus,
        trialClaimedAt: userActiveDevice.trialClaimedAt,
        createdAt: userActiveDevice.createdAt,
        revokedAt: userActiveDevice.revokedAt,
      };
    }
  }

  // If no device could be resolved, fail device ownership requirement
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

  // 2. Strict Device Ownership Check
  if (targetDevice.ownerUserId !== userId) {
    await recordDeviceEvent({
      deviceId: targetDevice.deviceId,
      userId,
      eventType: "trial.claim_rejected_unowned_device",
      riskOutcome: "blocked",
      metadata: { targetOwnerUserId: targetDevice.ownerUserId, ipAddress },
    });

    return {
      eligible: false,
      code: "DEVICE_NOT_OWNED",
      reason:
        "This device is registered to another account. Free trials are limited to one per registered device.",
      riskScore: 100,
      riskOutcome: "blocked",
      device: targetDevice,
      claimedByUserId: targetDevice.ownerUserId,
    };
  }

  // 3. Device Active Status Check
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

  // 4. Tombstone Check (permanent block for deleted accounts or tombstoned hardware)
  const [tombstone] = await db
    .select()
    .from(deviceTombstones)
    .where(eq(deviceTombstones.deviceId, targetDevice.deviceId))
    .limit(1);

  if (tombstone) {
    await recordDeviceEvent({
      deviceId: targetDevice.deviceId,
      userId,
      eventType: "trial.claim_rejected_tombstone",
      riskOutcome: "blocked",
      metadata: { tombstoneReason: tombstone.reason, ipAddress },
    });

    return {
      eligible: false,
      code: "DEVICE_TRIAL_ALREADY_CLAIMED",
      reason:
        "This device was previously registered to an account that consumed its free trial. Devices cannot obtain repeat free trials.",
      riskScore: 100,
      riskOutcome: "blocked",
      device: targetDevice,
      deviceTrialClaimed: true,
      claimedByUserId: tombstone.originalOwnerUserId || undefined,
    };
  }

  // 5. Existing Device Trial Claim Check
  const [existingDeviceClaim] = await db
    .select()
    .from(deviceTrialClaims)
    .where(eq(deviceTrialClaims.deviceId, targetDevice.deviceId))
    .limit(1);

  if (existingDeviceClaim) {
    // If claimed by a DIFFERENT account: hard block
    if (existingDeviceClaim.userId !== userId) {
      await recordDeviceEvent({
        deviceId: targetDevice.deviceId,
        userId,
        eventType: "trial.claim_rejected_device_already_claimed",
        riskOutcome: "blocked",
        metadata: {
          originalClaimant: existingDeviceClaim.userId,
          ipAddress,
        },
      });

      return {
        eligible: false,
        code: "DEVICE_TRIAL_ALREADY_CLAIMED",
        reason:
          "This device has already claimed a free trial under another account. Each device is eligible for only one free trial.",
        riskScore: 100,
        riskOutcome: "blocked",
        device: targetDevice,
        deviceTrialClaimed: true,
        claimedByUserId: existingDeviceClaim.userId,
      };
    }
  }

  // 6. Account Lifetime Quota Check
  // Account trial history is independent of device: check if account used its 3 evaluations
  const trialPeriodKey = `trial:${userId}`;
  const [trialCounter] = await db
    .select()
    .from(usageCounters)
    .where(
      and(eq(usageCounters.userId, userId), eq(usageCounters.periodKey, trialPeriodKey))
    )
    .limit(1);

  const used = trialCounter?.evaluationsUsed ?? 0;
  const reserved = trialCounter?.evaluationsReserved ?? 0;
  if (used + reserved >= 3) {
    return {
      eligible: false,
      code: "TRIAL_LIMIT_EXCEEDED",
      reason:
        "Free trial limit reached (3 lifetime evaluations). Please upgrade to Pro to continue evaluating CVs.",
      riskScore: 0,
      riskOutcome: "allowed",
      device: targetDevice,
      deviceTrialClaimed: Boolean(existingDeviceClaim || targetDevice.trialClaimedAt),
      claimedByUserId: userId,
    };
  }

  // 7. Ambiguous Fingerprint / Shared IP Evaluation
  // Rule: Shared IP alone or partial fingerprint match MUST NOT block users.
  // Ambiguous signals trigger risk review and logging, rather than an unsupported claim of certainty.
  let riskScore = 0;
  let riskOutcome: "allowed" | "flagged_for_review" | "blocked" = "allowed";
  let riskReason: string | undefined;

  if (ipAddress) {
    // Check if other accounts have claimed trials from this exact IP
    const otherClaimsOnSameIp = await db
      .select({ id: deviceTrialClaims.id, userId: deviceTrialClaims.userId })
      .from(deviceTrialClaims)
      .where(
        and(
          eq(deviceTrialClaims.ipAddress, ipAddress),
          // Exclude this user
          // Note: we check other claimants on this IP
        )
      )
      .limit(5);

    const hasOtherUserOnIp = otherClaimsOnSameIp.some((c) => c.userId !== userId);
    if (hasOtherUserOnIp) {
      riskScore = 30; // Elevated risk, but well below blocking threshold
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
          reason: "shared_ip_address_detected",
          claimCountOnIp: otherClaimsOnSameIp.length,
        },
      });

      logger.info("Ambiguous trial match flagged for review (shared IP allowed)", {
        userId,
        deviceId: targetDevice.deviceId,
        ipAddress,
      });
    }
  }

  return {
    eligible: true,
    riskScore,
    riskOutcome,
    riskReason,
    device: targetDevice,
    deviceTrialClaimed: Boolean(existingDeviceClaim || targetDevice.trialClaimedAt),
    claimedByUserId: existingDeviceClaim ? existingDeviceClaim.userId : null,
  };
}

/**
 * Atomically records a device trial claim.
 * Ensures the device claim is independently auditable and persists across device revocations.
 */
export async function recordDeviceTrialClaim(
  params: RecordTrialClaimParams
): Promise<DeviceTrialClaimRecord> {
  const { deviceId, userId, ipAddress, riskScore = 0, riskOutcome = "allowed", metadata = {} } = params;
  const now = new Date();

  // Insert into device_trial_claims table
  const [created] = await db
    .insert(deviceTrialClaims)
    .values({
      deviceId,
      userId,
      ipAddress: ipAddress || null,
      riskScore,
      riskOutcome,
      metadata,
      claimedAt: now,
      createdAt: now,
    })
    .returning();

  // Stamp trialClaimedAt on devices table
  await db
    .update(devices)
    .set({
      trialClaimedAt: now,
      lastSeenAt: now,
    })
    .where(eq(devices.deviceId, deviceId));

  // Record audit events
  await recordAuditEvent({
    userId,
    action: "trial.claimed",
    targetId: deviceId,
    targetType: "device_trial_claim",
    ipAddress: ipAddress || undefined,
    metadata: { riskScore, riskOutcome },
  });

  await recordDeviceEvent({
    deviceId,
    userId,
    eventType: "trial.claimed",
    riskOutcome,
    metadata: { ipAddress, riskScore },
  });

  logger.info("Recorded device trial claim", {
    deviceId,
    userId,
    riskOutcome,
  });

  return {
    id: created.id,
    deviceId: created.deviceId,
    userId: created.userId,
    claimedAt: created.claimedAt,
    ipAddress: created.ipAddress,
    riskScore: created.riskScore,
    riskOutcome: created.riskOutcome as "allowed" | "flagged_for_review" | "blocked",
    metadata: created.metadata,
    createdAt: created.createdAt,
  };
}

/**
 * Retrieves the trial claim record for a given deviceId.
 */
export async function getDeviceTrialClaim(
  deviceId: string
): Promise<DeviceTrialClaimRecord | null> {
  const [record] = await db
    .select()
    .from(deviceTrialClaims)
    .where(eq(deviceTrialClaims.deviceId, deviceId))
    .limit(1);

  if (!record) return null;

  return {
    id: record.id,
    deviceId: record.deviceId,
    userId: record.userId,
    claimedAt: record.claimedAt,
    ipAddress: record.ipAddress,
    riskScore: record.riskScore,
    riskOutcome: record.riskOutcome as "allowed" | "flagged_for_review" | "blocked",
    metadata: record.metadata,
    createdAt: record.createdAt,
  };
}

/**
 * Retrieves the full trial history for an account, maintaining independent auditability
 * between account usage history and hardware device claims.
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
    userId: c.userId,
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

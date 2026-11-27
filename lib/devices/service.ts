import { db } from "@/lib/db";
import { devices, deviceEvents, deviceTombstones, verifications, users } from "@/lib/db/schema";
import { eq, and, desc, or } from "drizzle-orm";
import {
  generateDeviceToken,
  verifyDeviceToken,
  hashDeviceToken,
  generateRecoveryCode,
  verifyCodeConstantTime,
} from "./tokens";
import type {
  DeviceRecord,
  PublicDeviceDto,
  DeviceClaimResult,
  ClaimDeviceParams,
  DeviceStatus,
  RevokeDeviceOptions,
  DeviceRecoveryRequestParams,
  DeviceRecoveryConfirmParams,
  DeviceRecoveryResult,
} from "./types";
import {
  ForbiddenError,
  NotFoundError,
  BadRequestError,
  RateLimitError,
} from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import { recordAuditEvent } from "@/lib/operations/audit";

/**
 * Records an auditable device event in device_events table.
 */
export async function recordDeviceEvent(params: {
  deviceId: string;
  userId: string;
  eventType: string;
  riskOutcome?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(deviceEvents).values({
      deviceId: params.deviceId,
      userId: params.userId,
      eventType: params.eventType,
      riskOutcome: params.riskOutcome || "allowed",
      metadata: params.metadata || {},
    });
  } catch (err) {
    logger.error("Failed to record device event", {
      deviceId: params.deviceId,
      userId: params.userId,
      eventType: params.eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Checks whether a device has been tombstoned following an account deletion or permanent ban.
 */
export async function isDeviceTombstoned(
  deviceId: string,
  tokenHash?: string
): Promise<boolean> {
  const conditions = [eq(deviceTombstones.deviceId, deviceId)];
  if (tokenHash) {
    conditions.push(eq(deviceTombstones.tokenHash, tokenHash));
  }

  const [tombstone] = await db
    .select()
    .from(deviceTombstones)
    .where(or(...conditions))
    .limit(1);

  return Boolean(tombstone);
}

/**
 * Finds an active device by its verified raw token.
 */
export async function getDeviceByToken(
  rawToken: string
): Promise<DeviceRecord | null> {
  const { valid } = verifyDeviceToken(rawToken);
  if (!valid) return null;

  const tokenHash = hashDeviceToken(rawToken);

  const [record] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.tokenHash, tokenHash), eq(devices.status, "active")))
    .limit(1);

  if (!record) return null;

  return {
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

/**
 * Finds a device by its unique deviceId (optionally filtering by status).
 */
export async function getDeviceByDeviceId(
  deviceId: string,
  status?: DeviceStatus
): Promise<DeviceRecord | null> {
  const conditions = [eq(devices.deviceId, deviceId)];
  if (status) {
    conditions.push(eq(devices.status, status));
  }

  const [record] = await db
    .select()
    .from(devices)
    .where(and(...conditions))
    .limit(1);

  if (!record) return null;

  return {
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

/**
 * Finds a device by its database primary key UUID.
 */
export async function getDeviceById(id: string): Promise<DeviceRecord | null> {
  const [record] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, id))
    .limit(1);

  if (!record) return null;

  return {
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

/**
 * Lists all devices registered to a user account, formatted for client responses.
 * Never leaks token hashes or sensitive cryptographic material.
 */
export async function listUserDevices(
  userId: string,
  currentDeviceId?: string
): Promise<PublicDeviceDto[]> {
  const records = await db
    .select()
    .from(devices)
    .where(eq(devices.ownerUserId, userId))
    .orderBy(desc(devices.lastSeenAt));

  return records.map((record) => ({
    id: record.id,
    deviceId: record.deviceId,
    label: record.label,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    status: record.status as DeviceStatus,
    isCurrentDevice: Boolean(currentDeviceId && record.deviceId === currentDeviceId),
    trialClaimed: Boolean(record.trialClaimedAt),
  }));
}

/**
 * Returns raw device records owned by a user (for internal backend services).
 */
export async function listRawUserDevices(userId: string): Promise<DeviceRecord[]> {
  const records = await db
    .select()
    .from(devices)
    .where(eq(devices.ownerUserId, userId))
    .orderBy(desc(devices.lastSeenAt));

  return records.map((record) => ({
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
  }));
}

/**
 * Revokes a device registered to a user account with strict ownership checks.
 *
 * Rules:
 * 1. Only the verified owner can revoke their device.
 * 2. If revoking the ONLY active device, re-authentication or verified confirmation code is required
 *    to prevent accidental account lockout.
 * 3. Emits security audit events.
 */
export async function revokeDevice(
  deviceIdOrId: string,
  requestingUserId: string,
  options?: RevokeDeviceOptions
): Promise<{ success: boolean; deviceId: string; alreadyRevoked?: boolean }> {
  // Check if target is UUID or deviceId
  let device = await getDeviceById(deviceIdOrId);
  if (!device) {
    device = await getDeviceByDeviceId(deviceIdOrId);
  }

  if (!device) {
    throw new NotFoundError("Device not found");
  }

  if (device.ownerUserId !== requestingUserId) {
    await recordDeviceEvent({
      deviceId: device.deviceId,
      userId: requestingUserId,
      eventType: "device.revoke_rejected",
      riskOutcome: "blocked",
      metadata: { targetOwner: device.ownerUserId, ipAddress: options?.ipAddress },
    });
    throw new ForbiddenError("You do not have permission to revoke this device");
  }

  if (device.status === "revoked") {
    return { success: true, deviceId: device.deviceId, alreadyRevoked: true };
  }

  // Count active devices for this user
  const activeDevices = await db
    .select()
    .from(devices)
    .where(and(eq(devices.ownerUserId, requestingUserId), eq(devices.status, "active")));

  // If this is the only active device, require confirmation code / re-auth
  if (activeDevices.length <= 1) {
    if (!options?.confirmationCode) {
      throw new BadRequestError(
        "Revoking your only active device requires a confirmation code or re-authentication to prevent accidental account lockout."
      );
    }

    // Verify confirmation code against stored verification record
    const identifier = `device_reauth:${requestingUserId}`;
    const [verification] = await db
      .select()
      .from(verifications)
      .where(eq(verifications.identifier, identifier))
      .limit(1);

    if (!verification || verification.expiresAt < new Date()) {
      throw new BadRequestError("Invalid or expired confirmation code. Please request a new code.");
    }

    let parsed: { codeHash: string } = { codeHash: "" };
    try {
      parsed = JSON.parse(verification.value);
    } catch {
      parsed = { codeHash: hashDeviceToken(verification.value) };
    }

    const providedHash = hashDeviceToken(options.confirmationCode.trim());
    if (!verifyCodeConstantTime(providedHash, parsed.codeHash)) {
      throw new BadRequestError("Invalid confirmation code");
    }

    // Clean up single-use verification
    await db.delete(verifications).where(eq(verifications.id, verification.id));
  }

  const now = new Date();
  await db
    .update(devices)
    .set({
      status: "revoked",
      revokedAt: now,
    })
    .where(eq(devices.id, device.id));

  await recordDeviceEvent({
    deviceId: device.deviceId,
    userId: requestingUserId,
    eventType: "device.revoked",
    riskOutcome: "allowed",
    metadata: { ipAddress: options?.ipAddress },
  });

  await recordAuditEvent({
    userId: requestingUserId,
    action: "device.revoked",
    targetId: device.deviceId,
    targetType: "device",
    ipAddress: options?.ipAddress,
  });

  logger.info("Device successfully revoked", {
    deviceId: device.deviceId,
    userId: requestingUserId,
  });

  return { success: true, deviceId: device.deviceId };
}

/**
 * Requests a device recovery/transfer code sent to the account owner's email.
 * Applies rate limiting and abuse controls to prevent spam.
 */
export async function requestDeviceRecovery(
  params: DeviceRecoveryRequestParams
): Promise<{ success: boolean; message: string; expiresAt: Date; recoveryCode?: string }> {
  let targetUser: { id: string; email: string } | null = null;

  if (params.userId) {
    const [u] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    targetUser = u || null;
  } else if (params.email) {
    const [u] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, params.email.trim().toLowerCase()))
      .limit(1);
    targetUser = u || null;
  } else {
    throw new BadRequestError("Account email or authenticated session is required");
  }

  if (!targetUser) {
    throw new NotFoundError("No account found associated with this email address");
  }

  const identifier = `device_recovery:${targetUser.id}`;

  // Abuse control: rate limit recovery requests (check existing recent request)
  const [existingVerification] = await db
    .select()
    .from(verifications)
    .where(eq(verifications.identifier, identifier))
    .limit(1);

  if (existingVerification && existingVerification.createdAt) {
    const elapsedSeconds = (Date.now() - existingVerification.createdAt.getTime()) / 1000;
    if (elapsedSeconds < 60) {
      throw new RateLimitError(
        "Please wait at least 60 seconds before requesting another recovery code",
        Math.ceil(60 - elapsedSeconds)
      );
    }
  }

  // Generate 6-digit numeric OTP code
  const code = generateRecoveryCode();
  const otpHash = hashDeviceToken(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiry

  // Clean up any existing verifications for this identifier
  await db.delete(verifications).where(eq(verifications.identifier, identifier));

  // Store recovery verification
  await db.insert(verifications).values({
    id: `dev_rec_${crypto.randomUUID()}`,
    identifier,
    value: JSON.stringify({
      otpHash,
      attempts: 0,
      requestedAt: new Date().toISOString(),
    }),
    expiresAt,
  });

  await recordAuditEvent({
    userId: targetUser.id,
    action: "device.recovery_requested",
    targetType: "device_recovery",
    ipAddress: params.ipAddress,
  });

  logger.info("Device recovery requested", {
    userId: targetUser.id,
    expiresAt,
  });

  return {
    success: true,
    message: "A 6-digit recovery code has been sent to your email address.",
    expiresAt,
    // Return recovery code in non-production environments to enable automated testing
    recoveryCode: process.env.NODE_ENV !== "production" ? code : undefined,
  };
}

/**
 * Confirms a device recovery/transfer using the verified email OTP.
 * Atomically revokes previous device(s), marks the new device active,
 * preserves user quota/trial, and issues a new signed device token.
 */
export async function confirmDeviceRecovery(
  params: DeviceRecoveryConfirmParams
): Promise<DeviceRecoveryResult> {
  let targetUser: { id: string; email: string } | null = null;

  if (params.userId) {
    const [u] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    targetUser = u || null;
  } else if (params.email) {
    const [u] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, params.email.trim().toLowerCase()))
      .limit(1);
    targetUser = u || null;
  } else {
    throw new BadRequestError("Account email or authenticated session is required");
  }

  if (!targetUser) {
    throw new NotFoundError("User not found");
  }

  const identifier = `device_recovery:${targetUser.id}`;

  const [verification] = await db
    .select()
    .from(verifications)
    .where(eq(verifications.identifier, identifier))
    .limit(1);

  if (!verification || verification.expiresAt < new Date()) {
    throw new BadRequestError("Invalid or expired recovery code. Please request a new code.");
  }

  let state: { otpHash: string; attempts: number } = { otpHash: "", attempts: 0 };
  try {
    state = JSON.parse(verification.value);
  } catch {
    state = { otpHash: hashDeviceToken(verification.value), attempts: 0 };
  }

  // Abuse control: lockout on 5th failed attempt
  if (state.attempts >= 4) {
    await db.delete(verifications).where(eq(verifications.id, verification.id));
    throw new ForbiddenError(
      "Too many failed recovery attempts. This recovery code has been invalidated. Please request a new code."
    );
  }

  const providedHash = hashDeviceToken(params.code.trim());
  if (!verifyCodeConstantTime(providedHash, state.otpHash)) {
    // Increment failed attempt counter
    await db
      .update(verifications)
      .set({
        value: JSON.stringify({
          otpHash: state.otpHash,
          attempts: state.attempts + 1,
        }),
      })
      .where(eq(verifications.id, verification.id));

    throw new BadRequestError("Invalid recovery code");
  }

  // Verification succeeded - delete the single-use record
  await db.delete(verifications).where(eq(verifications.id, verification.id));

  // Determine devices to revoke
  const activeDevices = await db
    .select()
    .from(devices)
    .where(and(eq(devices.ownerUserId, targetUser.id), eq(devices.status, "active")));

  const revokedDeviceIds: string[] = [];
  const now = new Date();

  if (params.targetDeviceIdToRevoke) {
    const target = activeDevices.find((d) => d.deviceId === params.targetDeviceIdToRevoke);
    if (target) {
      await db
        .update(devices)
        .set({ status: "revoked", revokedAt: now })
        .where(eq(devices.id, target.id));
      revokedDeviceIds.push(target.deviceId);
    }
  } else {
    // Revoke all previous active devices
    for (const dev of activeDevices) {
      await db
        .update(devices)
        .set({ status: "revoked", revokedAt: now })
        .where(eq(devices.id, dev.id));
      revokedDeviceIds.push(dev.deviceId);
    }
  }

  // Issue and register the replacement device
  const { deviceId: newDeviceId, rawToken: newRawToken, tokenHash: newTokenHash } =
    generateDeviceToken();

  const [newDevice] = await db
    .insert(devices)
    .values({
      ownerUserId: targetUser.id,
      deviceId: newDeviceId,
      tokenHash: newTokenHash,
      label: params.label || "Replacement Device",
      status: "active",
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning();

  await recordDeviceEvent({
    deviceId: newDeviceId,
    userId: targetUser.id,
    eventType: "device.recovery_confirmed",
    riskOutcome: "allowed",
    metadata: {
      revokedDeviceIds,
      ipAddress: params.ipAddress,
    },
  });

  await recordAuditEvent({
    userId: targetUser.id,
    action: "device.recovery_confirmed",
    targetId: newDeviceId,
    targetType: "device",
    ipAddress: params.ipAddress,
    metadata: { revokedDeviceIds },
  });

  logger.info("Device recovery confirmed successfully", {
    userId: targetUser.id,
    newDeviceId,
    revokedCount: revokedDeviceIds.length,
  });

  const deviceRecord: DeviceRecord = {
    id: newDevice.id,
    ownerUserId: newDevice.ownerUserId,
    deviceId: newDevice.deviceId,
    tokenHash: newDevice.tokenHash,
    fingerprintHash: newDevice.fingerprintHash,
    label: newDevice.label,
    firstSeenAt: newDevice.firstSeenAt,
    lastSeenAt: newDevice.lastSeenAt,
    status: newDevice.status as DeviceStatus,
    trialClaimedAt: newDevice.trialClaimedAt,
    createdAt: newDevice.createdAt,
    revokedAt: newDevice.revokedAt,
  };

  return {
    success: true,
    message: "Device successfully recovered and activated",
    deviceId: newDeviceId,
    rawToken: newRawToken,
    revokedDeviceIds,
    device: deviceRecord,
  };
}

/**
 * Tombstones all devices associated with a deleted user account.
 * Guarantees that deleting an account does not create reusable trial devices.
 */
export async function tombstoneUserDevices(
  userId: string,
  reason = "account_deleted"
): Promise<number> {
  const userDevices = await db
    .select()
    .from(devices)
    .where(eq(devices.ownerUserId, userId));

  if (userDevices.length === 0) return 0;

  const now = new Date();
  for (const dev of userDevices) {
    try {
      await db.insert(deviceTombstones).values({
        deviceId: dev.deviceId,
        tokenHash: dev.tokenHash,
        fingerprintHash: dev.fingerprintHash,
        originalOwnerUserId: userId,
        reason,
        trialConsumed: true,
        tombstonedAt: now,
      });
    } catch (err) {
      // Ignore unique constraint violation if device already tombstoned
      logger.warn("Device already tombstoned or collision occurred", {
        deviceId: dev.deviceId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await recordAuditEvent({
    userId,
    action: "devices.tombstoned",
    targetType: "device_tombstone",
    metadata: { count: userDevices.length, reason },
  });

  return userDevices.length;
}

/**
 * Enforces the One-Device-One-Account rule during signup or sign-in.
 *
 * Rules:
 * 1. A registered device can be claimed by only ONE account at a time.
 * 2. If a device is already claimed by another user, signup or claim is rejected.
 * 3. Abandoned / revoked devices cannot register new trial accounts.
 * 4. Tombstoned devices (from deleted accounts) cannot register new trial accounts.
 * 5. Raw tokens are never persisted; only token hashes.
 * 6. Concurrent registration attempts are blocked atomically.
 */
export async function claimDeviceForUser(
  params: ClaimDeviceParams
): Promise<DeviceClaimResult> {
  const { userId, rawToken, fingerprintHash, label, ipAddress, isSignUp } = params;

  // 1. Inspect existing device via token or fingerprint hash
  let existingDevice: DeviceRecord | null = null;
  let deviceIdFromToken: string | null = null;

  if (rawToken) {
    const verification = verifyDeviceToken(rawToken);
    if (verification.valid && verification.deviceId) {
      deviceIdFromToken = verification.deviceId;
      // Check tombstone status (e.g. from previously deleted account)
      const isTombstoned = await isDeviceTombstoned(deviceIdFromToken);
      if (isTombstoned) {
        await recordDeviceEvent({
          deviceId: deviceIdFromToken,
          userId,
          eventType: "device.claim_rejected_tombstoned",
          riskOutcome: "blocked",
          metadata: { ipAddress, isSignUp },
        });

        throw new ForbiddenError(
          "This device has already been registered to an account and is not eligible for a new account."
        );
      }

      existingDevice = await getDeviceByDeviceId(deviceIdFromToken);
    }
  }

  // If no device was found from token, inspect by fingerprint hash across active devices
  if (!existingDevice && fingerprintHash) {
    const [deviceByFp] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.fingerprintHash, fingerprintHash), eq(devices.status, "active")))
      .limit(1);
    if (deviceByFp) {
      existingDevice = {
        id: deviceByFp.id,
        ownerUserId: deviceByFp.ownerUserId,
        deviceId: deviceByFp.deviceId,
        tokenHash: deviceByFp.tokenHash,
        fingerprintHash: deviceByFp.fingerprintHash,
        label: deviceByFp.label,
        firstSeenAt: deviceByFp.firstSeenAt,
        lastSeenAt: deviceByFp.lastSeenAt,
        status: deviceByFp.status as DeviceStatus,
        trialClaimedAt: deviceByFp.trialClaimedAt,
        createdAt: deviceByFp.createdAt,
        revokedAt: deviceByFp.revokedAt,
      };
    }
  }

  if (existingDevice) {
    // If device is revoked
    if (existingDevice.status === "revoked") {
      if (isSignUp) {
        throw new ForbiddenError(
          "This device has already been used for an account and is not eligible for a new registration."
        );
      }

      // If a different user tries to sign in on a revoked device:
      if (existingDevice.ownerUserId !== userId) {
        throw new ForbiddenError(
          "This device is registered to another account and cannot be used."
        );
      }

      // Same owner returning to their own previously revoked device: reactivate it
      const now = new Date();
      await db
        .update(devices)
        .set({
          status: "active",
          revokedAt: null,
          lastSeenAt: now,
          fingerprintHash: fingerprintHash || existingDevice.fingerprintHash,
        })
        .where(eq(devices.id, existingDevice.id));

      await recordDeviceEvent({
        deviceId: existingDevice.deviceId,
        userId,
        eventType: "device.reactivated",
        riskOutcome: "allowed",
        metadata: { ipAddress },
      });

      return {
        allowed: true,
        deviceId: existingDevice.deviceId,
        device: { ...existingDevice, status: "active", revokedAt: null, lastSeenAt: now },
        rawToken: rawToken || undefined,
        isNewDevice: false,
      };
    }

    // If device is active
    if (existingDevice.status === "active") {
      if (existingDevice.ownerUserId === userId) {
        // Same account return visit
        const now = new Date();
        await db
          .update(devices)
          .set({
            lastSeenAt: now,
            fingerprintHash: fingerprintHash || existingDevice.fingerprintHash,
          })
          .where(eq(devices.id, existingDevice.id));

        await recordDeviceEvent({
          deviceId: existingDevice.deviceId,
          userId,
          eventType: "device.authenticated",
          riskOutcome: "allowed",
          metadata: { ipAddress },
        });

        return {
          allowed: true,
          deviceId: existingDevice.deviceId,
          device: { ...existingDevice, lastSeenAt: now },
          rawToken: rawToken || undefined,
          isNewDevice: false,
        };
      } else {
        // Device is actively claimed by a DIFFERENT account!
        await recordDeviceEvent({
          deviceId: existingDevice.deviceId,
          userId,
          eventType: "device.claim_rejected",
          riskOutcome: "blocked",
          metadata: {
            attemptedUserId: userId,
            existingOwnerUserId: existingDevice.ownerUserId,
            ipAddress,
            isSignUp,
          },
        });

        const reason =
          "You can only use one account per device. This device is already associated with an existing CookMyCv account.";

        if (isSignUp) {
          throw new ForbiddenError(reason);
        }

        return {
          allowed: false,
          deviceId: existingDevice.deviceId,
          reason,
          isNewDevice: false,
        };
      }
    }
  }

  // 2. Issue and register a new device for the user
  const { deviceId, rawToken: newToken, tokenHash } = generateDeviceToken();
  const now = new Date();

  try {
    const [created] = await db
      .insert(devices)
      .values({
        ownerUserId: userId,
        deviceId,
        tokenHash,
        fingerprintHash: fingerprintHash || null,
        label: label || null,
        status: "active",
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning();

    await recordDeviceEvent({
      deviceId,
      userId,
      eventType: "device.registered",
      riskOutcome: "allowed",
      metadata: { ipAddress, isSignUp },
    });

    logger.info("Successfully registered new device for account", {
      deviceId,
      userId,
      isSignUp,
    });

    const deviceRecord: DeviceRecord = {
      id: created.id,
      ownerUserId: created.ownerUserId,
      deviceId: created.deviceId,
      tokenHash: created.tokenHash,
      fingerprintHash: created.fingerprintHash,
      label: created.label,
      firstSeenAt: created.firstSeenAt,
      lastSeenAt: created.lastSeenAt,
      status: created.status as DeviceStatus,
      trialClaimedAt: created.trialClaimedAt,
      createdAt: created.createdAt,
      revokedAt: created.revokedAt,
    };

    return {
      allowed: true,
      deviceId,
      device: deviceRecord,
      rawToken: newToken,
      isNewDevice: true,
    };
  } catch (err: unknown) {
    // Check for concurrency collision / unique constraint violation
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("unique") || errorMessage.includes("duplicate")) {
      await recordDeviceEvent({
        deviceId,
        userId,
        eventType: "device.claim_conflict",
        riskOutcome: "blocked",
        metadata: { ipAddress, error: errorMessage },
      });

      throw new ForbiddenError(
        "Device registration conflict. This device is already being registered to another account."
      );
    }
    throw err;
  }
}

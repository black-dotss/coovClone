export * from "./types";
export * from "./tokens";
export * from "./fingerprint";
export * from "./service";
export * from "./trial-eligibility";

import { getDeviceByDeviceId } from "./service";
import type { DeviceClaimResult } from "./types";

/**
 * Checks whether a specific deviceId is claimed by a specific user.
 */
export async function verifyDeviceClaim(
  deviceId: string,
  userId: string
): Promise<DeviceClaimResult> {
  const device = await getDeviceByDeviceId(deviceId);
  if (!device || device.status !== "active") {
    return { allowed: true, deviceId };
  }
  if (device.ownerUserId === userId) {
    return { allowed: true, deviceId, device };
  }
  return {
    allowed: false,
    deviceId,
    reason: "Device is actively registered to another account",
  };
}

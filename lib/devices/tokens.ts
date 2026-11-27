import crypto from "node:crypto";
import { getEnv } from "@/lib/env";

export const DEVICE_COOKIE_NAME = "__cookmycv_device_token";
export const DEVICE_TOKEN_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year

/**
 * Computes an HMAC-SHA256 signature for a given payload.
 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Computes a SHA-256 hash of a raw device token for database storage.
 * Raw device tokens are NEVER persisted to the database.
 */
export function hashDeviceToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
}

/**
 * Generates a new cryptographically random device ID and signed opaque token.
 * Format: `<deviceId>.<randomEntropy>.<signature>`
 */
export function generateDeviceToken(existingDeviceId?: string): {
  deviceId: string;
  rawToken: string;
  tokenHash: string;
} {
  const secret = getEnv().DEVICE_TOKEN_SECRET;
  const deviceId = existingDeviceId || `dev_${crypto.randomUUID()}`;
  const randomEntropy = crypto.randomBytes(32).toString("hex");
  const payload = `${deviceId}.${randomEntropy}`;
  const signature = signPayload(payload, secret);
  const rawToken = `${payload}.${signature}`;
  const tokenHash = hashDeviceToken(rawToken);

  return {
    deviceId,
    rawToken,
    tokenHash,
  };
}

/**
 * Verifies the cryptographic HMAC signature of a raw device token.
 * Prevents client tampering or forging of device identities.
 */
export function verifyDeviceToken(rawToken: string): {
  valid: boolean;
  deviceId: string | null;
} {
  if (!rawToken || typeof rawToken !== "string") {
    return { valid: false, deviceId: null };
  }

  const parts = rawToken.split(".");
  if (parts.length !== 3) {
    return { valid: false, deviceId: null };
  }

  const [deviceId, randomEntropy, providedSignature] = parts;
  if (!deviceId || !randomEntropy || !providedSignature) {
    return { valid: false, deviceId: null };
  }

  const secret = getEnv().DEVICE_TOKEN_SECRET;
  const payload = `${deviceId}.${randomEntropy}`;
  const expectedSignature = signPayload(payload, secret);

  const providedBuf = Buffer.from(providedSignature, "hex");
  const expectedBuf = Buffer.from(expectedSignature, "hex");

  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, deviceId: null };
  }

  const matches = crypto.timingSafeEqual(providedBuf, expectedBuf);
  if (!matches) {
    return { valid: false, deviceId: null };
  }

  return { valid: true, deviceId };
}

/**
 * Extracts the device token from a request's Cookie header string.
 */
export function parseDeviceTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${DEVICE_COOKIE_NAME}=`));

  if (!match) return null;
  const val = match.slice(DEVICE_COOKIE_NAME.length + 1).trim();
  return val || null;
}

/**
 * Builds the Set-Cookie header value for the device token cookie.
 */
export function buildDeviceCookie(rawToken: string): string {
  const isProd = getEnv().NODE_ENV === "production";
  const secureFlag = isProd ? "Secure; " : "";
  return `${DEVICE_COOKIE_NAME}=${rawToken}; Path=/; Max-Age=${DEVICE_TOKEN_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax; ${secureFlag}`.trim();
}

/**
 * Builds a Set-Cookie header value to clear/revoke the device cookie.
 */
export function buildClearDeviceCookie(): string {
  return `${DEVICE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax;`;
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP for device recovery/re-auth.
 */
export function generateRecoveryCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Constant-time comparison of two string hashes or codes to prevent timing side channels.
 */
export function verifyCodeConstantTime(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

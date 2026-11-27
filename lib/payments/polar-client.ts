import { createPolar } from "@polar-sh/sdk/2026-10";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/shared/logger";

export type PolarClient = ReturnType<typeof createPolar>;

function resolveEnvVar(name: string): string | undefined {
  const val = process.env[name];
  if (val !== undefined) {
    return val.trim() !== "" ? val : undefined;
  }
  try {
    const fromEnv = (getEnv() as unknown as Record<string, string | undefined>)[name];
    return fromEnv && fromEnv.trim() !== "" ? fromEnv : undefined;
  } catch {
    return undefined;
  }
}

let cachedWorkingEnv: "sandbox" | "production" | null = null;

export function getPolarEnvironment(): "sandbox" | "production" {
  if (cachedWorkingEnv) {
    return cachedWorkingEnv;
  }
  const rawServer = (resolveEnvVar("POLAR_SERVER") || "sandbox")
    .trim()
    .toLowerCase();

  const isSandbox =
    rawServer === "sandbox" ||
    rawServer.includes("sandbox") ||
    rawServer === "";

  return isSandbox ? "sandbox" : "production";
}

export function getPolarClient(overrideEnv?: "sandbox" | "production"): PolarClient {
  const token =
    resolveEnvVar("POLAR_ACCESS_TOKEN") || resolveEnvVar("POLAR_API_KEY");
  if (!token) {
    throw new Error("POLAR_ACCESS_TOKEN is not configured");
  }

  const environment = overrideEnv || getPolarEnvironment();

  return createPolar({
    accessToken: token,
    environment,
  });
}

export function isPolarAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as Record<string, unknown>;
  if (anyErr.statusCode === 401 || anyErr.status === 401) return true;
  if (typeof anyErr.message === "string") {
    const msg = anyErr.message.toLowerCase();
    return (
      msg.includes("401") ||
      msg.includes("invalid_token") ||
      msg.includes("expired, revoked, malformed")
    );
  }
  return false;
}

export async function executePolarCall<T>(
  fn: (polar: PolarClient) => Promise<T>
): Promise<T> {
  const primaryEnv = getPolarEnvironment();
  const altEnv: "sandbox" | "production" =
    primaryEnv === "sandbox" ? "production" : "sandbox";

  try {
    const primaryClient = getPolarClient(primaryEnv);
    const result = await fn(primaryClient);
    cachedWorkingEnv = primaryEnv;
    return result;
  } catch (err) {
    if (isPolarAuthError(err)) {
      logger.warn("Polar auth error on primary environment, attempting fallback", {
        primaryEnv,
        altEnv,
      });

      try {
        const altClient = getPolarClient(altEnv);
        const altResult = await fn(altClient);
        cachedWorkingEnv = altEnv;
        logger.info("Polar call succeeded with fallback environment", {
          successfulEnv: altEnv,
        });
        return altResult;
      } catch (fallbackErr) {
        if (isPolarAuthError(fallbackErr)) {
          throw new Error(
            "Polar access token is invalid or expired for both sandbox and production environments. Please verify your POLAR_ACCESS_TOKEN."
          );
        }
        throw fallbackErr;
      }
    }
    throw err;
  }
}

export function getPolarProductIdForTier(tier: string): string | undefined {
  const normalized = tier.toLowerCase().trim();
  if (normalized === "pro_plus_monthly") {
    return resolveEnvVar("POLAR_PRODUCT_ID_PRO_PLUS_MONTHLY");
  }
  if (normalized === "pro_plus_yearly") {
    return resolveEnvVar("POLAR_PRODUCT_ID_PRO_PLUS_YEARLY");
  }
  if (normalized === "executive_unlimited" || normalized === "unlimited_yearly") {
    return (
      resolveEnvVar("POLAR_PRODUCT_ID_EXECUTIVE_UNLIMITED") ||
      resolveEnvVar("POLAR_PRODUCT_ID_UNLIMITED_YEARLY")
    );
  }
  return resolveEnvVar("POLAR_PRODUCT_ID_PRO_MONTHLY");
}

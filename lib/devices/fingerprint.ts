import crypto from "node:crypto";

/**
 * Derives a privacy-conscious fingerprint hash from request headers.
 * Used strictly for risk scoring and anomaly detection, not as an infallible identifier.
 */
export function generateFingerprintHash(headers: Headers): string {
  const userAgent = headers.get("user-agent") || "";
  const acceptLanguage = headers.get("accept-language") || "";
  const secChUa = headers.get("sec-ch-ua") || "";
  const secChUaPlatform = headers.get("sec-ch-ua-platform") || "";

  const components = [userAgent, acceptLanguage, secChUa, secChUaPlatform].join("|");

  return crypto.createHash("sha256").update(components).digest("hex");
}

/**
 * Extracts the client IP address from standard forward headers.
 * Note: IP addresses are used as short-lived risk signals only, never for automatic hard blocking.
 */
export function extractClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return headers.get("x-real-ip") || "127.0.0.1";
}

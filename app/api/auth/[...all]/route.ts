import { handleAuthProxyRequest } from "@neon/auth/server";
import { getEnv } from "@/lib/env";
import { db, devices, users } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import {
  parseDeviceTokenFromCookie,
  getDeviceByToken,
  claimDeviceForUser,
  buildDeviceCookie,
} from "@/lib/devices";
import type { DeviceStatus } from "@/lib/devices/types";
import {
  generateFingerprintHash,
  extractClientIp,
} from "@/lib/devices/fingerprint";
import { recordDeviceEvent } from "@/lib/devices/service";
import { logger } from "@/lib/shared/logger";
import { ForbiddenError } from "@/lib/shared/errors";

async function proxyAuth(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Extract subpath after /api/auth/
  const subpath = url.pathname.replace(/^\/?api\/auth\/?/, "");

  const rawDeviceToken = parseDeviceTokenFromCookie(req.headers.get("cookie"));
  const fingerprintHash = generateFingerprintHash(req.headers);
  const ipAddress = extractClientIp(req.headers);

  // 1. One-Device-One-Account Pre-checks:
  // If the device already has an active registration belonging to another account,
  // block account creation or cross-account logins immediately.
  if (subpath.includes("sign-up") || (subpath.includes("sign-in") && req.method === "POST")) {
    try {
      let existingDevice = rawDeviceToken ? await getDeviceByToken(rawDeviceToken) : null;
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

      if (existingDevice && existingDevice.status === "active") {
        if (subpath.includes("sign-up")) {
          await recordDeviceEvent({
            deviceId: existingDevice.deviceId,
            userId: existingDevice.ownerUserId,
            eventType: "device.claim_rejected",
            riskOutcome: "blocked",
            metadata: {
              ipAddress,
              reason: "signup_blocked_device_already_registered_to_another_account",
            },
          });

          return new Response(
            JSON.stringify({
              code: "DEVICE_CONFLICT",
              message:
                "You can only use one account per device. This device is already associated with an existing account.",
              error: {
                code: "DEVICE_CONFLICT",
                message:
                  "You can only use one account per device. This device is already associated with an existing account.",
              },
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          );
        } else if (subpath.includes("sign-in")) {
          // For sign-in, check if email matches the device owner
          try {
            const cloned = req.clone();
            const body = await cloned.json();
            const attemptEmail = body?.email ? String(body.email).toLowerCase().trim() : null;

            if (attemptEmail) {
              const [ownerUser] = await db
                .select({ id: users.id, email: users.email })
                .from(users)
                .where(eq(users.id, existingDevice.ownerUserId))
                .limit(1);

              if (ownerUser && ownerUser.email && ownerUser.email.toLowerCase().trim() !== attemptEmail) {
                await recordDeviceEvent({
                  deviceId: existingDevice.deviceId,
                  userId: existingDevice.ownerUserId,
                  eventType: "device.claim_rejected",
                  riskOutcome: "blocked",
                  metadata: {
                    attemptedEmail: attemptEmail,
                    ownerEmail: ownerUser.email,
                    ipAddress,
                    reason: "signin_blocked_device_registered_to_different_account",
                  },
                });

                return new Response(
                  JSON.stringify({
                    code: "DEVICE_CONFLICT",
                    message:
                      `You can only use one account per device. This device is already linked to another account (${ownerUser.email}).`,
                    error: {
                      code: "DEVICE_CONFLICT",
                      message:
                        `You can only use one account per device. This device is already linked to another account (${ownerUser.email}).`,
                    },
                  }),
                  {
                    status: 403,
                    headers: { "Content-Type": "application/json" },
                  }
                );
              }
            }
          } catch {
            // If body could not be parsed as JSON, proceed to Neon Auth
          }
        }
      }
    } catch (err) {
      logger.warn("Device pre-check skipped", { err });
    }
  }

  // 2. Prepare request for Neon Auth proxy
  let requestToForward = req;

  // For social sign in, ensure callbackURL is an absolute URL
  if (subpath.includes("sign-in/social") && req.method === "POST") {
    try {
      const cloned = req.clone();
      const body = await cloned.json();
      if (body && typeof body === "object") {
        const appUrl = getEnv().NEXT_PUBLIC_APP_URL || url.origin;
        let modified = false;

        if (
          body.callbackURL &&
          typeof body.callbackURL === "string" &&
          !body.callbackURL.startsWith("http")
        ) {
          body.callbackURL = new URL(body.callbackURL, appUrl).href;
          modified = true;
        }

        if (modified) {
          const newHeaders = new Headers(req.headers);
          newHeaders.set("Content-Type", "application/json");
          if (!newHeaders.get("origin")) {
            newHeaders.set("origin", appUrl);
          }
          requestToForward = new Request(req.url, {
            method: req.method,
            headers: newHeaders,
            body: JSON.stringify(body),
          });
        }
      }
    } catch {
      // Fallback to original request
    }
  }

  // Ensure origin header is set
  if (!requestToForward.headers.get("origin")) {
    const newHeaders = new Headers(requestToForward.headers);
    newHeaders.set("origin", getEnv().NEXT_PUBLIC_APP_URL || url.origin);
    requestToForward = new Request(requestToForward.url, {
      method: requestToForward.method,
      headers: newHeaders,
      body: requestToForward.body,
    });
  }

  // 3. Forward request to Neon Managed Better Auth
  const response = await handleAuthProxyRequest({
    request: requestToForward,
    path: subpath,
    baseUrl: getEnv().NEON_AUTH_BASE_URL,
    cookieSecret: getEnv().NEON_AUTH_COOKIE_SECRET,
  });

  // 4. Post-Auth Device Claim & Cookie Issuance:
  // On successful signup or signin, associate the device with the authenticated account.
  if (
    response.ok &&
    (subpath.includes("sign-up") || subpath.includes("sign-in") || subpath.includes("callback"))
  ) {
    try {
      const clone = response.clone();
      let responseBody: Record<string, unknown> = {};
      try {
        responseBody = await clone.json();
      } catch {
        responseBody = {};
      }

      const user = (responseBody.user || responseBody) as
        | { id?: string }
        | undefined;
      const userId = user?.id;

      if (userId && typeof userId === "string") {
        const isSignUp = subpath.includes("sign-up");

        const claimResult = await claimDeviceForUser({
          userId,
          rawToken: rawDeviceToken,
          fingerprintHash,
          ipAddress,
          isSignUp,
        });

        if (claimResult.allowed && claimResult.rawToken) {
          const newHeaders = new Headers(response.headers);
          newHeaders.append("Set-Cookie", buildDeviceCookie(claimResult.rawToken));
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        }

        if (!claimResult.allowed) {
          const errorHeaders = new Headers();
          const setCookies = response.headers.getSetCookie();
          for (const sc of setCookies) {
            if (sc.toLowerCase().includes("session") || sc.toLowerCase().includes("auth")) {
              const cookieName = sc.split("=")[0].trim();
              errorHeaders.append("Set-Cookie", `${cookieName}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly`);
            }
          }
          if (subpath.includes("callback")) {
            errorHeaders.set("Location", "/device-limit");
            return new Response(null, {
              status: 302,
              headers: errorHeaders,
            });
          }
          errorHeaders.set("Content-Type", "application/json");
          return new Response(
            JSON.stringify({
              code: "DEVICE_CONFLICT",
              message:
                claimResult.reason ||
                "You can only use one account per device. This device is already associated with an existing account.",
              error: {
                code: "DEVICE_CONFLICT",
                message:
                  claimResult.reason ||
                  "You can only use one account per device. This device is already associated with an existing account.",
              },
            }),
            {
              status: 403,
              headers: errorHeaders,
            }
          );
        }
      }
    } catch (err: unknown) {
      if (err instanceof ForbiddenError || (err instanceof Error && err.message.toLowerCase().includes("device"))) {
        const errorHeaders = new Headers();
        errorHeaders.set("Content-Type", "application/json");
        const setCookies = response.headers.getSetCookie();
        for (const sc of setCookies) {
          if (sc.toLowerCase().includes("session") || sc.toLowerCase().includes("auth")) {
            const cookieName = sc.split("=")[0].trim();
            errorHeaders.append("Set-Cookie", `${cookieName}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly`);
          }
        }
        return new Response(
          JSON.stringify({
            error: {
              code: "DEVICE_CONFLICT",
              message:
                err instanceof Error
                  ? err.message
                  : "You can only use one account per device. This device is already associated with an existing account.",
            },
          }),
          {
            status: 403,
            headers: errorHeaders,
          }
        );
      }
      logger.warn("Post-auth device claim skipped", { err });
    }
  }

  // On HTTP (e.g. localhost dev), duplicate any Secure cookies without Secure flag so browsers don't drop them
  if (url.protocol === "http:") {
    const setCookies = response.headers.getSetCookie();
    let hasSecure = false;
    for (const cookie of setCookies) {
      if (cookie.toLowerCase().includes("secure")) {
        hasSecure = true;
        break;
      }
    }
    if (hasSecure) {
      const newHeaders = new Headers(response.headers);
      for (const cookie of setCookies) {
        if (cookie.toLowerCase().includes("secure")) {
          const nonSecure = cookie
            .replace(/;\s*secure/gi, "")
            .replace(/__Secure-/g, "");
          newHeaders.append("Set-Cookie", nonSecure);
        }
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }
  }

  return response;
}

export async function GET(req: Request): Promise<Response> {
  return proxyAuth(req);
}

export async function POST(req: Request): Promise<Response> {
  return proxyAuth(req);
}

export async function PUT(req: Request): Promise<Response> {
  return proxyAuth(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return proxyAuth(req);
}

export async function PATCH(req: Request): Promise<Response> {
  return proxyAuth(req);
}

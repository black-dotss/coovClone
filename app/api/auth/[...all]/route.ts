import { handleAuthProxyRequest } from "@neon/auth/server";
import { getEnv } from "@/lib/env";
import {
  parseDeviceTokenFromCookie,
  parseHardwareTokenFromCookie,
  getDeviceByToken,
  claimDeviceForUser,
  buildDeviceCookie,
  buildHardwareCookie,
} from "@/lib/devices";
import {
  generateFingerprintHash,
  extractClientIp,
} from "@/lib/devices/fingerprint";
import { logger } from "@/lib/shared/logger";

async function proxyAuth(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const subpath = url.pathname.replace(/^\/?api\/auth\/?/, "");

  const rawDeviceToken = parseDeviceTokenFromCookie(req.headers.get("cookie"));
  const rawHardwareToken = parseHardwareTokenFromCookie(req.headers.get("cookie"));
  const fingerprintHash = generateFingerprintHash(req.headers);
  const ipAddress = extractClientIp(req.headers);

  // 1. Prepare request for Neon Auth proxy
  let requestToForward = req;

  // For social sign in, ensure callbackURL is an absolute URL matching the active request origin
  if (subpath.includes("sign-in/social") && req.method === "POST") {
    try {
      const cloned = req.clone();
      const body = await cloned.json();
      if (body && typeof body === "object") {
        const requestOrigin = req.headers.get("origin") || url.origin;
        const appUrl = requestOrigin || getEnv().NEXT_PUBLIC_APP_URL || url.origin;
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

  // Ensure origin header is set using actual request origin before NEXT_PUBLIC_APP_URL fallback
  if (!requestToForward.headers.get("origin")) {
    const newHeaders = new Headers(requestToForward.headers);
    newHeaders.set("origin", url.origin || getEnv().NEXT_PUBLIC_APP_URL);
    requestToForward = new Request(requestToForward.url, {
      method: requestToForward.method,
      headers: newHeaders,
      body: requestToForward.body,
    });
  }

  // 2. Forward request to Neon Managed Better Auth
  const response = await handleAuthProxyRequest({
    request: requestToForward,
    path: subpath,
    baseUrl: getEnv().NEON_AUTH_BASE_URL,
    cookieSecret: getEnv().NEON_AUTH_COOKIE_SECRET,
  });

  const extraCookies: string[] = [];

  // 3. Post-Auth Multi-Account Device + Hardware Registration:
  // Multiple accounts may sign in on the same device. Each account gets its own
  // session-bound device cookie while sharing the browser's physical hardware ID.
  const isAuthTransition =
    subpath.includes("sign-up") ||
    subpath.includes("sign-in") ||
    subpath.includes("verify-email") ||
    subpath.includes("callback") ||
    subpath.includes("get-session");

  if (response.ok && isAuthTransition) {
    try {
      const clone = response.clone();
      let responseBody: Record<string, unknown> = {};
      try {
        responseBody = await clone.json();
      } catch {
        responseBody = {};
      }

      const user = (responseBody?.user || responseBody) as
        | { id?: string }
        | undefined;
      const userId = user?.id;

      if (userId && typeof userId === "string") {
        // Fast-path for get-session: skip DB write if current device & hw cookies already match userId
        let needsClaim = !subpath.includes("get-session");
        if (!needsClaim) {
          const activeDev = rawDeviceToken ? await getDeviceByToken(rawDeviceToken) : null;
          if (!activeDev || activeDev.ownerUserId !== userId || !rawHardwareToken) {
            needsClaim = true;
          }
        }

        if (needsClaim) {
          const claimResult = await claimDeviceForUser({
            userId,
            rawToken: rawDeviceToken,
            rawHardwareToken,
            fingerprintHash,
            ipAddress,
            isSignUp: subpath.includes("sign-up"),
          });

          if (claimResult.allowed) {
            if (claimResult.rawToken) {
              extraCookies.push(buildDeviceCookie(claimResult.rawToken));
            }
            if (claimResult.rawHardwareToken) {
              extraCookies.push(buildHardwareCookie(claimResult.rawHardwareToken));
            }
          }
        }
      }
    } catch (err: unknown) {
      logger.warn("Post-auth device claim skipped", { err });
    }
  }

  // 4. On HTTP (e.g. localhost dev), duplicate any Secure cookies without Secure flag
  const setCookies = response.headers.getSetCookie();
  let needsCookieRewrite = extraCookies.length > 0;
  const nonSecureCookies: string[] = [];

  if (url.protocol === "http:") {
    for (const cookie of setCookies) {
      if (cookie.toLowerCase().includes("secure")) {
        needsCookieRewrite = true;
        nonSecureCookies.push(
          cookie
            .replace(/;\s*secure/gi, "")
            .replace(/__Secure-/g, "")
        );
      }
    }
  }

  if (needsCookieRewrite) {
    const newHeaders = new Headers(response.headers);
    for (const c of extraCookies) {
      newHeaders.append("Set-Cookie", c);
    }
    for (const c of nonSecureCookies) {
      newHeaders.append("Set-Cookie", c);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
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

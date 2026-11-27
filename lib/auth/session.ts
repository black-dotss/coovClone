import { headers as nextHeaders } from "next/headers";
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { parseCookies } from "better-auth/cookies";
import { validateSessionData } from "@neon/auth/server";
import { UnauthorizedError, ForbiddenError } from "@/lib/shared/errors";
import { db, users } from "@/lib/db";
import type { SessionContext, SessionUser } from "./types";
import { getEnv } from "@/lib/env";

let jwksClient: JWTVerifyGetKey | null = null;

function getJwksClient(): JWTVerifyGetKey {
  if (!jwksClient) {
    const jwksUrl = new URL(getEnv().NEON_AUTH_JWKS_URL);
    jwksClient = createRemoteJWKSet(jwksUrl);
  }
  return jwksClient;
}

/**
 * Validates a Bearer JWT against Neon Auth's JWKS endpoint.
 */
export async function verifyJwksToken(token: string): Promise<SessionContext | null> {
  try {
    const JWKS = getJwksClient();
    const { payload } = await jwtVerify(token, JWKS);
    if (!payload || !payload.sub) {
      return null;
    }

    const user: SessionUser = {
      id: String(payload.sub),
      email: (payload.email as string) || "",
      name: (payload.name as string) || (payload.email as string) || "",
      image: (payload.picture as string) || (payload.image as string) || null,
    };

    const expDate = payload.exp
      ? new Date(payload.exp * 1000)
      : new Date(Date.now() + 86400 * 1000);

    return {
      user,
      sessionToken: token,
      expiresAt: expDate,
    };
  } catch (_err) {
    return null;
  }
}

/**
 * Resolves the authenticated session from request headers or Next.js async headers().
 * Supports:
 * 1. Bearer tokens verified via Neon Auth JWKS
 * 2. Instant local session data verification via signed cookies
 * 3. Fallback remote get-session resolution via Neon Managed Better Auth
 */
export async function getSession(headersInput?: Headers): Promise<SessionContext | null> {
  try {
    let activeHeaders = headersInput;
    if (!activeHeaders) {
      try {
        activeHeaders = await nextHeaders();
      } catch {
        activeHeaders = undefined;
      }
    }

    // 1. Bearer Token Verification via Neon Auth JWKS
    const authHeader = activeHeaders?.get("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      const jwksSession = await verifyJwksToken(token);
      if (jwksSession) {
        return jwksSession;
      }
    }

    // 2. Cookie Extraction (from provided headers or async nextHeaders fallback)
    let cookieHeader = activeHeaders?.get("cookie");
    if (!cookieHeader) {
      try {
        const fallbackHeaders = await nextHeaders();
        cookieHeader = fallbackHeaders.get("cookie");
      } catch {
        cookieHeader = null;
      }
    }

    if (!cookieHeader) {
      return null;
    }

    const cookies = parseCookies(cookieHeader);

    // 3. Fast-path: Check local signed session data cookie
    const sessionDataCookie =
      cookies.get("__Secure-neon-auth.local.session_data") ||
      cookies.get("neon-auth.local.session_data");

    if (sessionDataCookie) {
      try {
        const validated = await validateSessionData(
          sessionDataCookie,
          getEnv().NEON_AUTH_COOKIE_SECRET
        );
        if (validated.valid && validated.payload?.user && validated.payload?.session) {
          const user: SessionUser = {
            id: validated.payload.user.id,
            email: validated.payload.user.email,
            name:
              validated.payload.user.name ||
              validated.payload.user.email.split("@")[0],
            image: validated.payload.user.image ?? null,
          };

          return {
            user,
            sessionToken: validated.payload.session.token || "token",
            expiresAt: new Date(validated.payload.session.expiresAt),
          };
        }
      } catch {
        // Fall back to upstream get-session
      }
    }

    // 4. Upstream session token lookup
    const sessionToken =
      cookies.get("__Secure-neon-auth.session_token") ||
      cookies.get("neon-auth.session_token") ||
      cookies.get("better-auth.session_token");

    if (!sessionToken) {
      return null;
    }

    const baseUrl = getEnv().NEON_AUTH_BASE_URL;
    const res = await fetch(`${baseUrl}/get-session`, {
      method: "GET",
      headers: {
        cookie: cookieHeader,
        origin: getEnv().NEXT_PUBLIC_APP_URL,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as {
      user?: { id: string; email: string; name?: string | null; image?: string | null };
      session?: { token: string; expiresAt: string | number | Date };
    } | null;

    if (!data || !data.user || !data.user.id) {
      return null;
    }

    const user: SessionUser = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name || data.user.email.split("@")[0],
      image: data.user.image ?? null,
    };

    return {
      user,
      sessionToken: data.session?.token || sessionToken,
      expiresAt: data.session?.expiresAt
        ? new Date(data.session.expiresAt)
        : new Date(Date.now() + 7 * 86400 * 1000),
    };
  } catch (_err) {
    return null;
  }
}

/**
 * Ensures the caller is authenticated; throws UnauthorizedError if not.
 */
export async function requireAuth(headersInput?: Headers): Promise<SessionContext> {
  const session = await getSession(headersInput);
  if (!session) {
    throw new UnauthorizedError("Authentication required to access this resource");
  }

  // Ensure user record exists in public.users to satisfy database foreign keys
  try {
    await db
      .insert(users)
      .values({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name || session.user.email,
        image: session.user.image || null,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          name: session.user.name || session.user.email,
          image: session.user.image || null,
          updatedAt: new Date(),
        },
      });
  } catch (_err) {
    // Non-blocking fallback
  }

  return session;
}

/**
 * Verifies that the current user owns the specified resource.
 * Throws ForbiddenError if the resource is owned by a different user.
 */
export function assertOwnership(
  resourceOwnerId: string,
  currentUserId: string,
  resourceName = "record"
): void {
  if (!resourceOwnerId || !currentUserId || resourceOwnerId !== currentUserId) {
    throw new ForbiddenError(
      `Access denied: You do not have permission to view or modify this ${resourceName}`
    );
  }
}

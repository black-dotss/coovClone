import { NextResponse, type NextRequest } from "next/server";
import { handleAuthProxyRequest } from "@neon/auth/server";
import { getEnv } from "@/lib/env";

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // Bypass webhook endpoints so external payment providers (Polar, Verify.ET) do not get blocked or redirected
  if (
    url.pathname.startsWith("/api/webhooks/") ||
    url.pathname.startsWith("/polar-sh/") ||
    url.pathname.startsWith("/api/polar-sh/")
  ) {
    return NextResponse.next();
  }

  const verifier = url.searchParams.get("neon_auth_session_verifier");

  // Handle Neon Auth OAuth session verification redirect
  if (verifier) {
    try {
      const baseUrl = getEnv().NEON_AUTH_BASE_URL;
      const cookieSecret = getEnv().NEON_AUTH_COOKIE_SECRET;

      const res = await handleAuthProxyRequest({
        request: req,
        path: "get-session",
        baseUrl,
        cookieSecret,
      });

      if (res.ok) {
        // Remove the verifier from the URL and redirect with session cookies
        const cleanUrl = new URL(url.pathname, url.origin);
        for (const [key, value] of url.searchParams.entries()) {
          if (key !== "neon_auth_session_verifier") {
            cleanUrl.searchParams.set(key, value);
          }
        }

        const redirectRes = NextResponse.redirect(cleanUrl);
        const setCookies = res.headers.getSetCookie();
        for (const cookie of setCookies) {
          redirectRes.headers.append("Set-Cookie", cookie);

          // For local development on plain HTTP (localhost), also set non-secure cookie variants
          // so browsers don't reject cookies with the Secure flag or __Secure- prefix
          if (url.protocol === "http:" && cookie.toLowerCase().includes("secure")) {
            const nonSecureCookie = cookie
              .replace(/;\s*secure/gi, "")
              .replace(/__Secure-/g, "");
            redirectRes.headers.append("Set-Cookie", nonSecureCookie);
          }
        }
        return redirectRes;
      }
    } catch (_err) {
      // Fall through on any transient network or parsing error
    }
  }

  return NextResponse.next();
}

export default middleware;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

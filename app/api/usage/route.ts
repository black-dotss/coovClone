import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getUserUsageSummary } from "@/lib/billing";
import {
  parseDeviceTokenFromCookie,
  parseHardwareTokenFromCookie,
} from "@/lib/devices/tokens";
import { extractClientIp } from "@/lib/devices/fingerprint";

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const rawCookieToken = parseDeviceTokenFromCookie(req.headers.get("cookie"));
  const rawHardwareToken = parseHardwareTokenFromCookie(req.headers.get("cookie"));
  const ipAddress = extractClientIp(req.headers);

  const usage = await getUserUsageSummary(session.user.id, {
    rawToken: rawCookieToken,
    rawHardwareToken,
    ipAddress,
    headers: req.headers,
  });

  return successResponse({
    ...usage,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    },
  });
});

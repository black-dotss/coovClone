import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { listUserDevices, parseDeviceTokenFromCookie, verifyDeviceToken } from "@/lib/devices";

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);

  // Identify the current device calling the endpoint if token cookie is present
  const rawCookieToken = parseDeviceTokenFromCookie(req.headers.get("cookie"));
  let currentDeviceId: string | undefined;
  if (rawCookieToken) {
    const verification = verifyDeviceToken(rawCookieToken);
    if (verification.valid && verification.deviceId) {
      currentDeviceId = verification.deviceId;
    }
  }

  const userDevices = await listUserDevices(session.user.id, currentDeviceId);

  return successResponse({
    devices: userDevices,
    total: userDevices.length,
    activeCount: userDevices.filter((d) => d.status === "active").length,
  });
});

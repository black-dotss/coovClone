import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import {
  revokeDevice,
  getDeviceById,
  getDeviceByDeviceId,
  parseDeviceTokenFromCookie,
  verifyDeviceToken,
} from "@/lib/devices";
import { NotFoundError, ForbiddenError } from "@/lib/shared/errors";
import { extractClientIp } from "@/lib/devices/fingerprint";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = createApiHandler(async (req: Request, context: RouteContext) => {
  const session = await requireAuth(req.headers);
  const { id } = await context.params;

  let device = await getDeviceById(id);
  if (!device) {
    device = await getDeviceByDeviceId(id);
  }

  if (!device) {
    throw new NotFoundError("Device not found");
  }

  if (device.ownerUserId !== session.user.id) {
    throw new ForbiddenError("You do not have permission to view this device");
  }

  const rawCookieToken = parseDeviceTokenFromCookie(req.headers.get("cookie"));
  let isCurrentDevice = false;
  if (rawCookieToken) {
    const verification = verifyDeviceToken(rawCookieToken);
    if (verification.valid && verification.deviceId === device.deviceId) {
      isCurrentDevice = true;
    }
  }

  return successResponse({
    id: device.id,
    deviceId: device.deviceId,
    label: device.label,
    firstSeenAt: device.firstSeenAt,
    lastSeenAt: device.lastSeenAt,
    status: device.status,
    isCurrentDevice,
  });
});

export const DELETE = createApiHandler(async (req: Request, context: RouteContext) => {
  const session = await requireAuth(req.headers);
  const { id } = await context.params;

  let body: { confirmationCode?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const ipAddress = extractClientIp(req.headers);

  const result = await revokeDevice(id, session.user.id, {
    confirmationCode: body.confirmationCode,
    ipAddress: ipAddress || undefined,
  });

  return successResponse(result);
});

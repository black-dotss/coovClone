import { createApiHandler, successResponse } from "@/lib/shared";
import { getSession } from "@/lib/auth";
import { confirmDeviceRecovery, buildDeviceCookie } from "@/lib/devices";
import { extractClientIp } from "@/lib/devices/fingerprint";
import { BadRequestError } from "@/lib/shared/errors";
import { z } from "zod";

const recoveryConfirmSchema = z.object({
  code: z.string().min(4, "Recovery code is required"),
  email: z.string().email().optional(),
  targetDeviceIdToRevoke: z.string().optional(),
  label: z.string().optional(),
});

export const POST = createApiHandler(async (req: Request) => {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = recoveryConfirmSchema.parse(body);
  const session = await getSession(req.headers);

  const email = parsed.email || session?.user?.email;
  const userId = session?.user?.id;

  if (!email && !userId) {
    throw new BadRequestError(
      "An account email or an active authenticated session is required to confirm device recovery."
    );
  }

  const ipAddress = extractClientIp(req.headers);

  const result = await confirmDeviceRecovery({
    email,
    userId,
    code: parsed.code,
    targetDeviceIdToRevoke: parsed.targetDeviceIdToRevoke,
    label: parsed.label,
    ipAddress: ipAddress || undefined,
  });

  const responseHeaders = new Headers();
  responseHeaders.append("Set-Cookie", buildDeviceCookie(result.rawToken));

  return successResponse(
    {
      success: true,
      message: result.message,
      deviceId: result.deviceId,
      revokedDeviceIds: result.revokedDeviceIds,
      device: {
        id: result.device.id,
        deviceId: result.device.deviceId,
        label: result.device.label,
        status: result.device.status,
        lastSeenAt: result.device.lastSeenAt,
      },
    },
    { headers: responseHeaders }
  );
});

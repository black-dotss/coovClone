import { createApiHandler, successResponse } from "@/lib/shared";
import { getSession } from "@/lib/auth";
import { requestDeviceRecovery } from "@/lib/devices";
import { extractClientIp } from "@/lib/devices/fingerprint";
import { BadRequestError } from "@/lib/shared/errors";
import { z } from "zod";

const recoveryRequestSchema = z.object({
  email: z.string().email().optional(),
  reason: z.string().optional(),
});

export const POST = createApiHandler(async (req: Request) => {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = recoveryRequestSchema.parse(body);
  const session = await getSession(req.headers);

  const email = parsed.email || session?.user?.email;
  const userId = session?.user?.id;

  if (!email && !userId) {
    throw new BadRequestError(
      "An account email or an active authenticated session is required to request device recovery."
    );
  }

  const ipAddress = extractClientIp(req.headers);

  const result = await requestDeviceRecovery({
    email,
    userId,
    reason: parsed.reason,
    ipAddress: ipAddress || undefined,
  });

  return successResponse(result);
});

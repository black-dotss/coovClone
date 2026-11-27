import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { freeDevice, assertAdmin } from "@/lib/operations";
import { z } from "zod";
import { BadRequestError } from "@/lib/shared/errors";

const FreeDeviceSchema = z.object({
  deviceId: z.string().optional(),
  userEmail: z.string().optional(),
});

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  const body = await req.json();
  const parsed = FreeDeviceSchema.parse(body);

  if (!parsed.deviceId && !parsed.userEmail) {
    throw new BadRequestError("Either deviceId or userEmail is required.");
  }

  const result = await freeDevice(
    {
      deviceId: parsed.deviceId,
      userEmail: parsed.userEmail,
    },
    session.user
  );

  return successResponse(result);
});

import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { toggleDeviceStatus, freeDevice, assertAdmin } from "@/lib/operations";
import { z } from "zod";

const PatchDeviceSchema = z.object({
  status: z.enum(["active", "revoked"]),
});

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    assertAdmin(session.user);

    const { id } = await context.params;
    const body = await req.json();
    const parsed = PatchDeviceSchema.parse(body);

    const result = await toggleDeviceStatus(id, parsed.status, session.user);
    return successResponse(result);
  }
);

export const DELETE = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    assertAdmin(session.user);

    const { id } = await context.params;
    const result = await freeDevice({ deviceId: id }, session.user);
    return successResponse(result);
  }
);

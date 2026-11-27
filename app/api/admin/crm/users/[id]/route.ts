import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import {
  getCrmUserDetail,
  updateUserAccountStatus,
  resetUserEvaluationUsage,
  assertAdmin,
} from "@/lib/operations";
import { z } from "zod";
import { BadRequestError } from "@/lib/shared/errors";

const PatchUserSchema = z.object({
  action: z.enum(["update_status", "reset_usage"]),
  status: z.enum(["active", "suspended"]).optional(),
});

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    assertAdmin(session.user);

    const { id } = await context.params;
    const userDetail = await getCrmUserDetail(id, session.user);
    return successResponse(userDetail);
  }
);

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    assertAdmin(session.user);

    const { id } = await context.params;
    const body = await req.json();
    const parsed = PatchUserSchema.parse(body);

    if (parsed.action === "update_status") {
      if (!parsed.status) {
        throw new BadRequestError("Status is required for update_status action.");
      }
      const updated = await updateUserAccountStatus(id, parsed.status, session.user);
      return successResponse(updated);
    }

    if (parsed.action === "reset_usage") {
      const result = await resetUserEvaluationUsage(id, session.user);
      return successResponse(result);
    }

    throw new BadRequestError("Unsupported action");
  }
);

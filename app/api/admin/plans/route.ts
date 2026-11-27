import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { adminListPlans, assertAdmin } from "@/lib/operations/admin";

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  const plansList = await adminListPlans(session.user.id);
  return successResponse(plansList);
});

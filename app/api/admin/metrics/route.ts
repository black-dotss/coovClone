import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { assertAdmin } from "@/lib/operations/admin";
import { getSystemMetrics } from "@/lib/operations/monitoring";

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  const metrics = await getSystemMetrics();
  return successResponse(metrics);
});

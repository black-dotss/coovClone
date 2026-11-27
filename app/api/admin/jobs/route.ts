import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { adminListFailedJobs, assertAdmin } from "@/lib/operations/admin";

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  const failedJobs = await adminListFailedJobs(session.user.id, limit);
  return successResponse(failedJobs);
});

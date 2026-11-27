import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getCrmOverview, assertAdmin } from "@/lib/operations";

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  const overview = await getCrmOverview(session.user);
  return successResponse(overview);
});

import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { listCrmUsers, assertAdmin } from "@/lib/operations";

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || undefined;
  const page = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : 1;
  const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 20;

  const result = await listCrmUsers({ search, page, limit }, session.user);
  return successResponse(result);
});

import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { assertAdmin } from "@/lib/operations/admin";
import { queryAuditEvents } from "@/lib/operations/audit";

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? undefined;
  const action = searchParams.get("action") ?? undefined;
  const targetType = searchParams.get("targetType") ?? undefined;
  const targetId = searchParams.get("targetId") ?? undefined;
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  const events = await queryAuditEvents({
    userId,
    action,
    targetType,
    targetId,
    limit,
    offset,
  });

  return successResponse(events);
});

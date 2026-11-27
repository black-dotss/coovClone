import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { adminListAmbiguousPayments, assertAdmin } from "@/lib/operations/admin";

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  const ambiguousOrders = await adminListAmbiguousPayments(session.user.id);
  return successResponse(ambiguousOrders);
});

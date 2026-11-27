import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { adminRetryJob, assertAdmin } from "@/lib/operations/admin";

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    assertAdmin(session.user);

    const { id } = await context.params;
    const result = await adminRetryJob(id, session.user.id);
    return successResponse(result);
  }
);

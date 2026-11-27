import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { completeInterviewSession } from "@/lib/interviews/service";

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const completed = await completeInterviewSession(id, session.user.id);
    return successResponse(completed);
  }
);

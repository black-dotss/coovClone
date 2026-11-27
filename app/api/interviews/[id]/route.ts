import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getInterviewSession } from "@/lib/interviews/service";

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const interview = await getInterviewSession(id, session.user.id);
    return successResponse(interview);
  }
);

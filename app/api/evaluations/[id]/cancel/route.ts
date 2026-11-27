import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { cancelEvaluation } from "@/lib/evaluations/worker";

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const progress = await cancelEvaluation(id, session.user.id);
    return successResponse(progress);
  }
);

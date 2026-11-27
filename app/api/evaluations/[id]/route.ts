import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getEvaluationDetails } from "@/lib/evaluations/service";

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const details = await getEvaluationDetails(id, session.user.id);
    return successResponse(details);
  }
);

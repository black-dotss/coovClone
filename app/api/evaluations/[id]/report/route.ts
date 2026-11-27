import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getEvaluationReport } from "@/lib/reports/service";

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const report = await getEvaluationReport(id, session.user.id);
    return successResponse(report);
  }
);

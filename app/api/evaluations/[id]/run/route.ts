import { after } from "next/server";
import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getEvaluationProgress } from "@/lib/evaluations/progress";
import { dispatchEvaluationExecution } from "@/lib/evaluations/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const progress = await getEvaluationProgress(id, session.user.id);

    if (progress.status === "completed" || progress.status === "failed" || progress.status === "cancelled") {
      return successResponse({
        evaluationId: id,
        status: progress.status,
        message: `Evaluation is already ${progress.status}`,
      });
    }

    // Launch or join existing execution non-blockingly so client streams progress live
    try {
      after(() => dispatchEvaluationExecution(id));
    } catch {
      void dispatchEvaluationExecution(id);
    }

    return successResponse({
      evaluationId: id,
      status: "processing",
      message: "Evaluation execution active",
    });
  }
);

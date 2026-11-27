import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { submitInterviewAnswer } from "@/lib/interviews/service";
import { SubmitAnswerSchema } from "@/lib/interviews/validation";

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const body = await req.json();
    const validated = SubmitAnswerSchema.parse(body);

    const feedback = await submitInterviewAnswer(id, session.user.id, validated);
    return successResponse(feedback, { status: 201 });
  }
);

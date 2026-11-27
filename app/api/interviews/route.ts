import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { startInterviewSession } from "@/lib/interviews/service";
import { StartInterviewSchema } from "@/lib/interviews/validation";

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const validated = StartInterviewSchema.parse(body);

  const interview = await startInterviewSession(validated.evaluationId, session.user.id);
  return successResponse(interview, { status: 201 });
});

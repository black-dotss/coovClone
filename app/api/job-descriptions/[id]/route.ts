import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getJobDescriptionById, deleteJobDescription } from "@/lib/job-descriptions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = createApiHandler(async (req: Request, context: RouteContext) => {
  const session = await requireAuth(req.headers);
  const { id } = await context.params;

  const record = await getJobDescriptionById(id, session.user.id);
  return successResponse(record);
});

export const DELETE = createApiHandler(async (req: Request, context: RouteContext) => {
  const session = await requireAuth(req.headers);
  const { id } = await context.params;

  const result = await deleteJobDescription(id, session.user.id);
  return successResponse(result);
});

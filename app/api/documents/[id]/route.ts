import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getDocumentById, deleteDocumentById } from "@/lib/documents";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = createApiHandler(async (req: Request, context: RouteContext) => {
  const session = await requireAuth(req.headers);
  const { id } = await context.params;

  const doc = await getDocumentById(id, session.user.id);
  return successResponse(doc);
});

export const DELETE = createApiHandler(async (req: Request, context: RouteContext) => {
  const session = await requireAuth(req.headers);
  const { id } = await context.params;

  const result = await deleteDocumentById(id, session.user.id);
  return successResponse(result);
});

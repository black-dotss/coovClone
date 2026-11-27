import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { hardDeleteDocument } from "@/lib/documents/retention";

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const result = await hardDeleteDocument(id, session.user.id);
    return successResponse(result);
  }
);

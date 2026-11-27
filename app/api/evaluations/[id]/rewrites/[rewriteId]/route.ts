import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { toggleAcceptRewrite } from "@/lib/reports/rewrites";
import { ToggleRewriteSchema } from "@/lib/reports/validation";

export const PATCH = createApiHandler(
  async (
    req: Request,
    context: { params: Promise<{ id: string; rewriteId: string }> }
  ) => {
    const session = await requireAuth(req.headers);
    const { rewriteId } = await context.params;
    const body = await req.json();
    const validated = ToggleRewriteSchema.parse(body);

    const updated = await toggleAcceptRewrite(rewriteId, session.user.id, validated.isAccepted);
    return successResponse(updated);
  }
);

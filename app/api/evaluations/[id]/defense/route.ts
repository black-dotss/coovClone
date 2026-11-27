import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { submitDefense, listDefenses } from "@/lib/reports/defense";
import { DefenseSubmissionSchema } from "@/lib/reports/validation";

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const revisions = await listDefenses(id, session.user.id);
    return successResponse(revisions);
  }
);

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const body = await req.json();
    const validated = DefenseSubmissionSchema.parse(body);

    const revision = await submitDefense(id, session.user.id, validated);
    return successResponse(revision, { status: 201 });
  }
);

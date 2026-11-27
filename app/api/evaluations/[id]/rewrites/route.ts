import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { generateBulletRewrites, listBulletRewrites } from "@/lib/reports/rewrites";
import { GenerateRewritesInputSchema } from "@/lib/reports/validation";

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const rewrites = await listBulletRewrites(id, session.user.id);
    return successResponse(rewrites);
  }
);

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const validated = GenerateRewritesInputSchema.parse(body);
    const rewrites = await generateBulletRewrites(id, session.user.id, validated);

    return successResponse(rewrites, { status: 201 });
  }
);

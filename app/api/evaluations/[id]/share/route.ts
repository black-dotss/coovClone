import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getEvaluationReport } from "@/lib/reports/service";
import { createShareLink, listShareLinksForReport } from "@/lib/reports/share";
import { assertRateLimit } from "@/lib/operations/rate-limiter";
import { z } from "zod";

const CreateShareLinkSchema = z.object({
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    assertRateLimit(session.user.id, "share_access");

    const { id } = await context.params;
    const report = await getEvaluationReport(id, session.user.id);

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      // Allow empty json body for default options
    }

    const input = CreateShareLinkSchema.parse(body);
    const link = await createShareLink(report.id, session.user.id, {
      expiresInDays: input.expiresInDays,
    });

    return successResponse(link, { status: 201 });
  }
);

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const report = await getEvaluationReport(id, session.user.id);

    const links = await listShareLinksForReport(report.id, session.user.id);
    return successResponse(links);
  }
);

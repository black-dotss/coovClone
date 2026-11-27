import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { matchJobDescriptionWithCv, matchCvAgainstJdSchema } from "@/lib/job-descriptions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = createApiHandler(async (req: Request, context: RouteContext) => {
  const session = await requireAuth(req.headers);
  const { id } = await context.params;
  const body = await req.json();
  const parsed = matchCvAgainstJdSchema.parse(body);

  const report = await matchJobDescriptionWithCv({
    jobDescriptionId: id,
    cvText: parsed.cvText,
    requestingUserId: session.user.id,
  });

  return successResponse(report);
});

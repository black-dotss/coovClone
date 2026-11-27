import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { compareCvWithJobDescriptions } from "@/lib/reports/comparisons";
import { MultiJdComparisonSchema } from "@/lib/reports/validation";

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const validated = MultiJdComparisonSchema.parse(body);

  const comparison = await compareCvWithJobDescriptions(session.user.id, validated);
  return successResponse(comparison);
});

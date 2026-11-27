import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { compareCvVersions } from "@/lib/documents/versions";
import { z } from "zod";

const CompareCvVersionsSchema = z.object({
  baseVersionId: z.string().uuid("Invalid base version ID"),
  targetVersionId: z.string().uuid("Invalid target version ID"),
});

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const input = CompareCvVersionsSchema.parse(body);

  const comparison = await compareCvVersions(
    input.baseVersionId,
    input.targetVersionId,
    session.user.id
  );

  return successResponse(comparison);
});

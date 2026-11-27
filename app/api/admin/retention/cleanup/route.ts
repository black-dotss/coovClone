import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { assertAdmin } from "@/lib/operations/admin";
import { cleanupExpiredDocuments } from "@/lib/documents/retention";
import { z } from "zod";

const RetentionCleanupSchema = z.object({
  retentionDays: z.number().int().min(1).max(365).optional(),
});

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // default body
  }

  const input = RetentionCleanupSchema.parse(body);
  const result = await cleanupExpiredDocuments(input.retentionDays ?? 30);

  return successResponse(result);
});

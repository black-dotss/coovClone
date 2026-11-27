import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { createJobDescription, listUserJobDescriptions } from "@/lib/job-descriptions";

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();

  const record = await createJobDescription(session.user.id, body);
  return successResponse(record, { status: 201 });
});

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const records = await listUserJobDescriptions(session.user.id);
  return successResponse(records);
});

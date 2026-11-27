import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { revokeShareLink } from "@/lib/reports/share";
import { z } from "zod";

const RevokeShareLinkSchema = z.object({
  shareLinkId: z.string().uuid("Invalid share link ID"),
});

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const { shareLinkId } = RevokeShareLinkSchema.parse(body);

  const result = await revokeShareLink(shareLinkId, session.user.id);
  return successResponse(result);
});

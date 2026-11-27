import { createApiHandler, successResponse } from "@/lib/shared";
import { getSharedReportByToken } from "@/lib/reports/share";
import { assertRateLimit } from "@/lib/operations/rate-limiter";

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ token: string }> }) => {
    // Rate limit public access by IP or general share access key
    const ip = req.headers.get("x-forwarded-for") ?? "anonymous-share-viewer";
    assertRateLimit(ip, "share_access");

    const { token } = await context.params;
    const result = await getSharedReportByToken(token);

    return successResponse(result);
  }
);

import { createApiHandler, successResponse } from "@/lib/shared";

export const GET = createApiHandler(async () => {
  return successResponse({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "cookmycv-api",
  });
});

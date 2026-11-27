import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { submitPaymentVerification } from "@/lib/payments/service";
import { SubmitPaymentVerificationSchema } from "@/lib/payments/validation";

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const validated = SubmitPaymentVerificationSchema.parse(body);

  const result = await submitPaymentVerification(session.user.id, validated);
  return successResponse(result);
});

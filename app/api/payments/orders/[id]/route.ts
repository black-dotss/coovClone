import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getPaymentOrder } from "@/lib/payments/service";

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const order = await getPaymentOrder(id, session.user.id);
    return successResponse(order);
  }
);

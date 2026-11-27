import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { createPaymentOrder, listPaymentOrders } from "@/lib/payments/service";
import { CreatePaymentOrderSchema } from "@/lib/payments/validation";

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const validated = CreatePaymentOrderSchema.parse(body);

  const order = await createPaymentOrder(session.user.id, validated);
  return successResponse(order, { status: 201 });
});

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const orders = await listPaymentOrders(session.user.id);
  return successResponse(orders);
});

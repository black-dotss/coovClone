import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { adminResolvePayment, assertAdmin } from "@/lib/operations/admin";
import { z } from "zod";

const ResolvePaymentSchema = z.object({
  action: z.enum(["approve", "reject"]),
  notes: z.string().max(500).optional(),
});

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    assertAdmin(session.user);

    const { id } = await context.params;
    const body = await req.json();
    const input = ResolvePaymentSchema.parse(body);

    const resolved = await adminResolvePayment(
      id,
      session.user.id,
      input.action,
      input.notes
    );

    return successResponse(resolved);
  }
);

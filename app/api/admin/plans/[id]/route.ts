import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { adminUpdatePlan, assertAdmin } from "@/lib/operations/admin";
import { z } from "zod";

const UpdatePlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  priceEtb: z.number().int().min(0).optional(),
  billingPeriodDays: z.number().int().min(0).optional(),
  dailyLimit: z.number().int().min(0).optional(),
  monthlyLimit: z.number().int().min(0).optional(),
  trialAllowance: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    assertAdmin(session.user);

    const { id } = await context.params;
    const body = await req.json();
    const updates = UpdatePlanSchema.parse(body);

    const updated = await adminUpdatePlan(id, session.user.id, updates);
    return successResponse(updated);
  }
);

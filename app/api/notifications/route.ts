import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { createApiHandler, successResponse } from "@/lib/shared";
import {
  listUserNotifications,
  markUserNotificationsRead,
  syncWalletAndBountyNotificationsForUser,
} from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

const MarkReadSchema = z.object({
  ids: z.array(z.string().uuid()).max(50).optional(),
  markAll: z.boolean().optional(),
});

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet")?.trim() || null;

  await syncWalletAndBountyNotificationsForUser({
    userId: session.user.id,
    connectedWallet: wallet,
  });

  const result = await listUserNotifications(session.user.id, 25);
  return successResponse(result);
});

export const PATCH = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const rawBody = await req.json().catch(() => ({}));
  const parsed = MarkReadSchema.parse(rawBody);

  const result = await markUserNotificationsRead({
    userId: session.user.id,
    ids: parsed.ids,
    markAll: parsed.markAll,
  });

  return successResponse(result);
});

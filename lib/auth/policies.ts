import { db, users, documents } from "@/lib/db";
import { eq, and, isNull } from "drizzle-orm";
import { assertOwnership } from "./session";
import { NotFoundError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import { tombstoneUserDevices } from "@/lib/devices/service";
import { recordAuditEvent } from "@/lib/operations/audit";

/**
 * Account deletion policy:
 * Performs cascade deletion of the user record from the database.
 * Before deletion, devices are safely tombstoned into `device_tombstones` to ensure
 * deleted accounts cannot leave behind reusable devices that circumvent the free trial limit.
 *
 * PostgreSQL FOREIGN KEY ON DELETE CASCADE automatically removes:
 * - Sessions, accounts, verifications
 * - User profile
 * - Subscriptions & usage counters/ledger
 * - Documents & CV versions
 * - Job descriptions, evaluations, agent runs, debate messages, reports
 * - Devices & device events
 * - Payment orders & verifications
 */
export async function deleteUserAccount(
  targetUserId: string,
  requestingUserId: string
): Promise<{ success: boolean; deletedUserId: string; tombstonedDevicesCount?: number }> {
  assertOwnership(targetUserId, requestingUserId, "account");

  logger.info("Executing account deletion policy", { userId: targetUserId });

  // 1. Tombstone user's registered devices so they cannot be reused for new free trial accounts
  const tombstonedCount = await tombstoneUserDevices(targetUserId, "account_deleted");

  // 2. Record security audit event
  await recordAuditEvent({
    userId: targetUserId,
    action: "account.deleted",
    targetId: targetUserId,
    targetType: "user",
    metadata: { tombstonedDevicesCount: tombstonedCount },
  });

  // 3. Delete user record (cascades across all related tables in PostgreSQL)
  await db.delete(users).where(eq(users.id, targetUserId));

  return { success: true, deletedUserId: targetUserId, tombstonedDevicesCount: tombstonedCount };
}

/**
 * Document deletion policy:
 * Enforces ownership check, then soft-deletes or permanently removes the document record.
 */
export async function deleteUserDocument(
  documentId: string,
  requestingUserId: string,
  options: { permanent?: boolean } = {}
): Promise<{ success: boolean; documentId: string }> {
  // Query document to verify existence and check ownership
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));

  if (!doc) {
    throw new NotFoundError("Document not found or already deleted");
  }

  assertOwnership(doc.ownerUserId, requestingUserId, "document");

  if (options.permanent) {
    logger.info("Permanently deleting document record", { documentId });
    await db.delete(documents).where(eq(documents.id, documentId));
  } else {
    logger.info("Soft-deleting document record", { documentId });
    await db
      .update(documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(documents.id, documentId));
  }

  return { success: true, documentId };
}

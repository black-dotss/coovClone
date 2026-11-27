import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq, and, isNotNull, lte } from "drizzle-orm";
import { storage } from "./storage";
import { ForbiddenError, NotFoundError } from "@/lib/shared/errors";
import { recordAuditEvent } from "@/lib/operations/audit";
import { logger } from "@/lib/shared/logger";

/**
 * Permanently deletes a document from storage and the database (hard purge).
 */
export async function hardDeleteDocument(
  documentId: string,
  requestingUserId: string
): Promise<{ success: boolean; documentId: string }> {
  const [doc] = await db
    .select({
      id: documents.id,
      ownerUserId: documents.ownerUserId,
      privateStorageKey: documents.privateStorageKey,
      filename: documents.filename,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    throw new NotFoundError("Document not found");
  }

  if (doc.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have permission to delete this document");
  }

  // 1. Remove file from storage
  await storage.deleteObject(doc.privateStorageKey);

  // 2. Remove database row (cascades to cv_versions, evaluations, etc.)
  await db.delete(documents).where(eq(documents.id, documentId));

  await recordAuditEvent({
    userId: requestingUserId,
    action: "document.hard_deleted",
    targetType: "document",
    targetId: documentId,
    metadata: { filename: doc.filename },
  });

  logger.info("Hard deleted document", { documentId, userId: requestingUserId });

  return { success: true, documentId };
}

/**
 * Retention policy cleaner that purges soft-deleted documents whose retention window has expired.
 */
export async function cleanupExpiredDocuments(
  retentionDays = 30
): Promise<{ purgedCount: number; purgedDocumentIds: string[] }> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const expiredDocs = await db
    .select({
      id: documents.id,
      ownerUserId: documents.ownerUserId,
      privateStorageKey: documents.privateStorageKey,
    })
    .from(documents)
    .where(and(isNotNull(documents.deletedAt), lte(documents.deletedAt, cutoff)));

  const purgedDocumentIds: string[] = [];

  for (const doc of expiredDocs) {
    try {
      await storage.deleteObject(doc.privateStorageKey);
      await db.delete(documents).where(eq(documents.id, doc.id));
      purgedDocumentIds.push(doc.id);
    } catch (err) {
      logger.error("Failed to purge expired document during retention cleanup", {
        documentId: doc.id,
        error: String(err),
      });
    }
  }

  if (purgedDocumentIds.length > 0) {
    await recordAuditEvent({
      action: "document.retention_cleanup",
      targetType: "document",
      metadata: {
        purgedCount: purgedDocumentIds.length,
        retentionDays,
        purgedDocumentIds,
      },
    });
  }

  logger.info("Executed retention policy cleanup", {
    retentionDays,
    purgedCount: purgedDocumentIds.length,
  });

  return {
    purgedCount: purgedDocumentIds.length,
    purgedDocumentIds,
  };
}

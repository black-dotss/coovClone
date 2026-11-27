import { db, documents, cvVersions } from "@/lib/db";
import { eq, and, isNull } from "drizzle-orm";
import { validateUploadFile } from "./validation";
import { storage } from "./storage";
import { assertOwnership } from "@/lib/auth/session";
import { NotFoundError, BadRequestError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import type { DocumentRecord, DocumentType } from "./types";

export interface UploadDocumentParams {
  ownerUserId: string;
  filename: string;
  declaredMimeType?: string;
  buffer: Buffer;
  documentType?: DocumentType;
}

export interface ProcessedDocumentResult extends DocumentRecord {
  cvVersion?: {
    id: string;
    versionNumber: number;
    extractedText: string | null;
  } | null;
  cvVersionId?: string | null;
}

export async function uploadAndProcessDocument(
  params: UploadDocumentParams
): Promise<ProcessedDocumentResult> {
  const docType: DocumentType = params.documentType === "cover_letter" ? "cover_letter" : "cv";

  // 1. Validate file (size, extension, binary signature, checksum)
  const validation = validateUploadFile(params.buffer, params.filename, params.declaredMimeType);

  // 2. Upload to private object storage
  const { storageKey } = await storage.putObject({
    userId: params.ownerUserId,
    filename: params.filename,
    buffer: params.buffer,
    mimeType: validation.detectedMimeType,
  });

  // 3. Persist document record with initial 'pending' status
  const [createdDoc] = await db
    .insert(documents)
    .values({
      ownerUserId: params.ownerUserId,
      type: docType,
      filename: params.filename,
      mimeType: validation.detectedMimeType,
      fileSize: validation.fileSize,
      checksum: validation.checksum,
      privateStorageKey: storageKey,
      extractedTextStatus: "extracting",
    })
    .returning();

  // 4. Server-side text extraction
  const { extractDocumentText } = await import("./extraction");
  const extraction = await extractDocumentText(params.buffer, validation.detectedMimeType);

  if (extraction.status === "failed") {
    logger.error("Document text extraction failed during upload", {
      filename: params.filename,
      errorMessage: extraction.errorMessage,
    });
    throw new BadRequestError(
      extraction.errorMessage ||
        "Could not extract readable text from this document. Please ensure your PDF is not encrypted or corrupted, and try again."
    );
  }

  if (extraction.status === "ocr_required" || !extraction.text || extraction.text.trim().length === 0) {
    logger.warn("Document contains no embedded text layer", {
      filename: params.filename,
      status: extraction.status,
    });
    throw new BadRequestError(
      "This document appears to be a scanned image without a selectable text layer. Please upload a PDF or DOCX file containing selectable text."
    );
  }

  // 5. Update document record with extraction results
  const [updatedDoc] = await db
    .update(documents)
    .set({
      extractedText: extraction.text || null,
      extractedTextStatus: extraction.status,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, createdDoc.id))
    .returning();

  // 6. If it's a CV, create the initial CV version
  let cvVersionRecord: {
    id: string;
    versionNumber: number;
    extractedText: string | null;
  } | null = null;

  if (docType === "cv") {
    const [insertedCvv] = await db
      .insert(cvVersions)
      .values({
        userId: params.ownerUserId,
        sourceDocumentId: updatedDoc.id,
        versionNumber: 1,
        extractedText: extraction.text || "",
      })
      .returning();

    cvVersionRecord = insertedCvv
      ? {
          id: insertedCvv.id,
          versionNumber: insertedCvv.versionNumber,
          extractedText: insertedCvv.extractedText,
        }
      : null;

    logger.info("Created initial CV version record", {
      documentId: updatedDoc.id,
      userId: params.ownerUserId,
      cvVersionId: insertedCvv?.id,
    });
  }

  logger.info("Processed document upload", {
    documentId: updatedDoc.id,
    type: docType,
    status: extraction.status,
    pageCount: extraction.pageCount,
  });

  return {
    id: updatedDoc.id,
    ownerUserId: updatedDoc.ownerUserId,
    type: updatedDoc.type as DocumentType,
    filename: updatedDoc.filename,
    mimeType: updatedDoc.mimeType,
    fileSize: updatedDoc.fileSize,
    checksum: updatedDoc.checksum,
    privateStorageKey: updatedDoc.privateStorageKey,
    extractedText: updatedDoc.extractedText,
    extractedTextStatus: updatedDoc.extractedTextStatus as DocumentRecord["extractedTextStatus"],
    deletedAt: updatedDoc.deletedAt,
    createdAt: updatedDoc.createdAt,
    updatedAt: updatedDoc.updatedAt,
    cvVersion: cvVersionRecord,
    cvVersionId: cvVersionRecord?.id || null,
  };
}

export async function getDocumentById(
  documentId: string,
  requestingUserId: string
): Promise<DocumentRecord> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));

  if (!doc) {
    throw new NotFoundError("Document not found or has been deleted");
  }

  assertOwnership(doc.ownerUserId, requestingUserId, "document");

  return {
    id: doc.id,
    ownerUserId: doc.ownerUserId,
    type: doc.type as DocumentType,
    filename: doc.filename,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    checksum: doc.checksum,
    privateStorageKey: doc.privateStorageKey,
    extractedText: doc.extractedText,
    extractedTextStatus: doc.extractedTextStatus as DocumentRecord["extractedTextStatus"],
    deletedAt: doc.deletedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function deleteDocumentById(
  documentId: string,
  requestingUserId: string
): Promise<{ success: boolean; documentId: string }> {
  const doc = await getDocumentById(documentId, requestingUserId);

  // Soft-delete the database record
  await db
    .update(documents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  // Remove from private storage
  await storage.deleteObject(doc.privateStorageKey);

  logger.info("Document deleted successfully", { documentId });
  return { success: true, documentId };
}

export async function listUserDocuments(userId: string): Promise<DocumentRecord[]> {
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.ownerUserId, userId), isNull(documents.deletedAt)));

  return docs.map((doc) => ({
    id: doc.id,
    ownerUserId: doc.ownerUserId,
    type: doc.type as DocumentType,
    filename: doc.filename,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    checksum: doc.checksum,
    privateStorageKey: doc.privateStorageKey,
    extractedText: doc.extractedText,
    extractedTextStatus: doc.extractedTextStatus as DocumentRecord["extractedTextStatus"],
    deletedAt: doc.deletedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }));
}

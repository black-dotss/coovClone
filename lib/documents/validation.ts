import { createHash } from "node:crypto";
import path from "node:path";
import { BadRequestError } from "@/lib/shared/errors";
import type { FileValidationResult } from "./types";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PAGE_COUNT = 10;
export const MAX_EXTRACTED_TEXT_CHARS = 100_000;
export const MIN_TEXT_CHARS_FOR_OCR_CHECK = 40;

// Magic bytes
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04 (for DOCX)

export const SUPPORTED_MIME_TYPES = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/**
 * Validates the file buffer, filename, MIME type, and binary magic bytes.
 */
export function validateUploadFile(
  buffer: Buffer,
  filename: string,
  _declaredMimeType?: string
): FileValidationResult {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestError("File buffer cannot be empty");
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new BadRequestError(
      `File size (${(buffer.length / 1024 / 1024).toFixed(2)} MB) exceeds the maximum allowed limit of 10 MB`
    );
  }

  const ext = path.extname(filename).toLowerCase();
  if (ext !== ".pdf" && ext !== ".docx") {
    throw new BadRequestError(
      `Unsupported file extension '${ext}'. Only .pdf and .docx files are supported.`
    );
  }

  // Verify binary magic numbers (file signature)
  let detectedMimeType: string;
  if (ext === ".pdf") {
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(PDF_MAGIC)) {
      throw new BadRequestError(
        "File signature does not match PDF format. The file may be corrupted or disguised."
      );
    }
    detectedMimeType = SUPPORTED_MIME_TYPES.PDF;
  } else {
    // .docx is a zipped openxml package
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
      throw new BadRequestError(
        "File signature does not match DOCX format. The file may be corrupted or disguised."
      );
    }
    detectedMimeType = SUPPORTED_MIME_TYPES.DOCX;
  }

  // Calculate SHA-256 checksum for audit & idempotency
  const checksum = createHash("sha256").update(buffer).digest("hex");

  return {
    isValid: true,
    detectedMimeType,
    fileExtension: ext,
    fileSize: buffer.length,
    checksum,
  };
}

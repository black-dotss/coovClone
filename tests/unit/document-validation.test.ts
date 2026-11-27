import { describe, it, expect } from "vitest";
import {
  validateUploadFile,
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_MIME_TYPES,
} from "@/lib/documents/validation";
import { BadRequestError } from "@/lib/shared/errors";

describe("Document File Validation", () => {
  it("accepts valid PDF with proper magic bytes", () => {
    // Valid PDF starts with %PDF (0x25, 0x50, 0x44, 0x46)
    const validPdfBuffer = Buffer.from("%PDF-1.4 sample pdf content for testing");
    const result = validateUploadFile(validPdfBuffer, "resume.pdf");

    expect(result.isValid).toBe(true);
    expect(result.detectedMimeType).toBe(SUPPORTED_MIME_TYPES.PDF);
    expect(result.fileExtension).toBe(".pdf");
    expect(result.fileSize).toBe(validPdfBuffer.length);
    expect(result.checksum).toBeDefined();
  });

  it("accepts valid DOCX with proper zip magic bytes", () => {
    // Valid DOCX starts with PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
    const validDocxBuffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("sample docx zip stream"),
    ]);
    const result = validateUploadFile(validDocxBuffer, "cover_letter.docx");

    expect(result.isValid).toBe(true);
    expect(result.detectedMimeType).toBe(SUPPORTED_MIME_TYPES.DOCX);
    expect(result.fileExtension).toBe(".docx");
    expect(result.checksum).toBeDefined();
  });

  it("rejects file with mismatched extension and magic bytes (e.g. plain text disguised as pdf)", () => {
    const fakePdfBuffer = Buffer.from("Just plain text, not a real pdf");
    expect(() => validateUploadFile(fakePdfBuffer, "fake.pdf")).toThrowError(
      BadRequestError
    );
  });

  it("rejects unsupported extensions (e.g. .txt, .png, .exe)", () => {
    const buffer = Buffer.from("some content");
    expect(() => validateUploadFile(buffer, "notes.txt")).toThrowError(
      BadRequestError
    );
    expect(() => validateUploadFile(buffer, "photo.png")).toThrowError(
      BadRequestError
    );
  });

  it("rejects oversized files exceeding 10 MB", () => {
    const oversizedBuffer = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1024);
    oversizedBuffer.set([0x25, 0x50, 0x44, 0x46]); // starts with %PDF

    expect(() => validateUploadFile(oversizedBuffer, "large.pdf")).toThrowError(
      BadRequestError
    );
  });

  it("rejects empty files", () => {
    const emptyBuffer = Buffer.alloc(0);
    expect(() => validateUploadFile(emptyBuffer, "empty.pdf")).toThrowError(
      BadRequestError
    );
  });
});

import "./polyfills";
import { ensurePdfPolyfills, ensurePdfWorker } from "./polyfills";
import {
  MAX_PAGE_COUNT,
  MAX_EXTRACTED_TEXT_CHARS,
  MIN_TEXT_CHARS_FOR_OCR_CHECK,
  SUPPORTED_MIME_TYPES,
} from "./validation";
import type { ExtractionResult, ExtractedPage } from "./types";
import { BadRequestError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

/**
 * Normalizes extracted text:
 * - Cleans up unicode variants (NFKC)
 * - Removes unprintable control characters (except newline, carriage return, and tab)
 * - Collapses runs of spaces while preserving paragraph breaks
 * - Retains original candidate claims, numbers, and dates
 */
export function normalizeExtractedText(raw: string): string {
  if (!raw) return "";

  return (
    raw
      .normalize("NFKC")
      // Remove null bytes and non-printable control characters
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      // Normalize line breaks to \n
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // Collapse excessive blank lines to max 2
      .replace(/\n{3,}/g, "\n\n")
      // Trim per-line trailing whitespace
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim()
  );
}

/**
 * Extracts text from PDF buffers, preserving page structure and detecting scanned documents.
 */
async function extractFromPdf(buffer: Buffer): Promise<ExtractionResult> {
  try {
    ensurePdfPolyfills();
    await ensurePdfWorker();
    const pdfParseMod = await import("pdf-parse");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyMod = pdfParseMod as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const PDFParseClass: any =
      anyMod.PDFParse ||
      anyMod.default?.PDFParse ||
      anyMod.default;
    const parser = new PDFParseClass({
      data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      verbosity: 0,
      stopAtErrors: false,
    });
    let pdfResult;
    try {
      pdfResult = await parser.getText();
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy().catch(() => {});
      }
    }
    const pageCount = pdfResult.total || pdfResult.pages?.length || 0;

    if (pageCount > MAX_PAGE_COUNT) {
      throw new BadRequestError(
        `PDF document has ${pageCount} pages, which exceeds the maximum limit of ${MAX_PAGE_COUNT} pages.`
      );
    }

    const pages: ExtractedPage[] = [];
    let combinedRaw = "";

    if (Array.isArray(pdfResult.pages) && pdfResult.pages.length > 0) {
      for (const p of pdfResult.pages) {
        const pageText = normalizeExtractedText(p.text || "");
        pages.push({
          pageNumber: p.num,
          text: pageText,
        });
        if (pageText.length > 0) {
          combinedRaw += `\n--- [Page ${p.num}] ---\n${pageText}\n`;
        }
      }
    } else {
      const fullText = normalizeExtractedText(pdfResult.text || "");
      combinedRaw = fullText;
      pages.push({ pageNumber: 1, text: fullText });
    }

    const normalizedFullText = normalizeExtractedText(combinedRaw);

    // Detect scanned PDF: pages exist but total extracted characters are negligible
    if (pageCount > 0 && normalizedFullText.length < MIN_TEXT_CHARS_FOR_OCR_CHECK) {
      logger.info("Scanned PDF detected without embedded text layer", { pageCount });
      return {
        text: "",
        pageCount,
        pages,
        status: "ocr_required",
        errorMessage: "This document appears to be a scanned image. OCR is required to extract text.",
      };
    }

    // Enforce text length limits
    const safeText = normalizedFullText.slice(0, MAX_EXTRACTED_TEXT_CHARS);

    return {
      text: safeText,
      pageCount,
      pages,
      status: "completed",
    };
  } catch (err: unknown) {
    if (err instanceof BadRequestError) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    if (/password|encrypted/i.test(message)) {
      throw new BadRequestError("Password-protected or encrypted PDF files are not supported.");
    }

    logger.warn("PDF extraction failed", { error: message });
    return {
      text: "",
      pageCount: 0,
      pages: [],
      status: "failed",
      errorMessage: `Failed to extract text from PDF: ${message}`,
    };
  }
}

/**
 * Extracts text from DOCX buffers using mammoth.
 */
async function extractFromDocx(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const mammothMod = await import("mammoth");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mammothInstance: any = mammothMod.default || mammothMod;
    const mammothResult = await mammothInstance.extractRawText({ buffer });
    const rawText = mammothResult.value || "";
    const normalizedText = normalizeExtractedText(rawText);

    if (normalizedText.length === 0) {
      return {
        text: "",
        pageCount: 1,
        pages: [],
        status: "ocr_required",
        errorMessage: "DOCX document contains no readable text content.",
      };
    }

    const safeText = normalizedText.slice(0, MAX_EXTRACTED_TEXT_CHARS);

    return {
      text: safeText,
      pageCount: 1, // DOCX does not have fixed pagination in raw xml
      pages: [{ pageNumber: 1, text: safeText }],
      status: "completed",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("DOCX extraction failed", { error: message });
    return {
      text: "",
      pageCount: 0,
      pages: [],
      status: "failed",
      errorMessage: `Failed to extract text from DOCX: ${message}`,
    };
  }
}

/**
 * Extracts text server-side based on detected MIME type.
 */
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  if (mimeType === SUPPORTED_MIME_TYPES.PDF) {
    return extractFromPdf(buffer);
  }
  if (mimeType === SUPPORTED_MIME_TYPES.DOCX) {
    return extractFromDocx(buffer);
  }

  throw new BadRequestError(`Unsupported MIME type '${mimeType}' for text extraction.`);
}

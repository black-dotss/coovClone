import { describe, it, expect } from "vitest";
import { normalizeExtractedText, extractDocumentText } from "@/lib/documents/extraction";
import {
  DOMMatrixPolyfill,
  ImageDataPolyfill,
  Path2DPolyfill,
  ensurePdfPolyfills,
  ensurePdfWorker,
} from "@/lib/documents/polyfills";
import { SUPPORTED_MIME_TYPES } from "@/lib/documents/validation";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

describe("Document Text Extraction and Normalization", () => {
  describe("normalizeExtractedText", () => {
    it("normalizes unicode, removes unprintable characters, and collapses whitespace", () => {
      const raw = "Senior Software Engineer\u0000\u0007\r\n\r\n\r\n\r\nGoogle Inc.   \n\nExperience with TypeScript   ";
      const normalized = normalizeExtractedText(raw);

      expect(normalized).not.toContain("\u0000");
      expect(normalized).not.toContain("\r");
      expect(normalized).toContain("Senior Software Engineer\n\nGoogle Inc.\n\nExperience with TypeScript");
    });

    it("preserves candidate metrics and dates accurately", () => {
      const claims = "Increased throughput by 45% between 2021-03 and 2023-11. Managed $2.5M budget.";
      const normalized = normalizeExtractedText(claims);
      expect(normalized).toBe(claims);
    });
  });

  describe("extractDocumentText with real PDF", () => {
    it("enforces maximum page count limit and rejects PDFs with > 10 pages", async () => {
      const guidePath = path.resolve(process.cwd(), "guide.pdf");
      if (existsSync(guidePath)) {
        const buffer = readFileSync(guidePath);
        await expect(
          extractDocumentText(buffer, SUPPORTED_MIME_TYPES.PDF)
        ).rejects.toThrowError(/exceeds the maximum limit of 10 pages/);
      }
    }, 15000);

    it("successfully extracts text from a real valid PDF document", async () => {
      const samplePath = path.resolve(
        process.cwd(),
        ".storage/documents/8fd16600-a59c-444f-bd7a-5769b1a318d0/957a9e3a-5038-4fe8-953d-fac0b43c88eb-Daniel_Okafor.pdf"
      );
      if (existsSync(samplePath)) {
        const buffer = readFileSync(samplePath);
        const result = await extractDocumentText(buffer, SUPPORTED_MIME_TYPES.PDF);
        expect(result.status).toBe("completed");
        expect(result.pageCount).toBe(3);
        expect(result.text).toContain("Daniel Okafor");
        expect(result.text).toContain("Senior Software Engineer");
      }
    });

    it("fails safely when PDF buffer is corrupt or unreadable", async () => {
      // Corrupt PDF: valid magic header but corrupted body
      const corruptPdf = Buffer.from("%PDF-1.4\ncorrupted random bytes that do not form valid objects");
      const result = await extractDocumentText(corruptPdf, SUPPORTED_MIME_TYPES.PDF);

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBeDefined();
    });
  });

  describe("ensurePdfPolyfills and DOM globals", () => {
    it("defines DOMMatrix, ImageData, and Path2D on globalThis", () => {
      ensurePdfPolyfills();
      expect(globalThis.DOMMatrix).toBeDefined();
      expect(globalThis.ImageData).toBeDefined();
      expect(globalThis.Path2D).toBeDefined();
    });

    it("supports 2D transformations on DOMMatrixPolyfill", () => {
      const matrix = new DOMMatrixPolyfill([1, 0, 0, 1, 10, 20]);
      expect(matrix.a).toBe(1);
      expect(matrix.d).toBe(1);
      expect(matrix.e).toBe(10);
      expect(matrix.f).toBe(20);

      matrix.translate(5, 5);
      expect(matrix.e).toBe(15);
      expect(matrix.f).toBe(25);

      matrix.scale(2, 2);
      expect(matrix.a).toBe(2);
      expect(matrix.d).toBe(2);

      const inverted = matrix.invertSelf();
      expect(inverted).toBeDefined();
    });

    it("supports instantiation of ImageDataPolyfill and Path2DPolyfill", () => {
      const img = new ImageDataPolyfill(10, 10);
      expect(img.width).toBe(10);
      expect(img.height).toBe(10);
      expect(img.data.length).toBe(400);

      const path = new Path2DPolyfill();
      expect(() => {
        path.rect(0, 0, 10, 10);
        path.addPath(path);
      }).not.toThrow();
    });

    it("preloads pdfjsWorker into globalThis via ensurePdfWorker", async () => {
      await ensurePdfWorker();
      const g = globalThis as Record<string, unknown>;
      expect(g.pdfjsWorker).toBeDefined();
    });
  });
});

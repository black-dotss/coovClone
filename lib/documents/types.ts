export type DocumentType = "cv" | "cover_letter";

export type ExtractionStatus =
  | "pending"
  | "extracting"
  | "completed"
  | "ocr_required"
  | "failed";

export interface DocumentRecord {
  id: string;
  ownerUserId: string;
  type: DocumentType;
  filename: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  privateStorageKey: string;
  extractedText: string | null;
  extractedTextStatus: ExtractionStatus;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  text: string;
  pageCount: number;
  pages: ExtractedPage[];
  status: ExtractionStatus;
  errorMessage?: string;
}

export interface FileValidationResult {
  isValid: boolean;
  detectedMimeType: string;
  fileExtension: string;
  fileSize: number;
  checksum: string;
}

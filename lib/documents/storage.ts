import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "@/lib/shared/logger";

const STORAGE_ROOT_DIR =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || (typeof process !== "undefined" && process.env.NODE_ENV === "production")
    ? path.resolve("/tmp", ".storage")
    : path.resolve(process.cwd(), ".storage");

export interface StorageService {
  putObject(params: {
    userId: string;
    filename: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<{ storageKey: string }>;

  getObject(storageKey: string): Promise<Buffer>;

  deleteObject(storageKey: string): Promise<void>;
}

/**
 * Local private object storage adapter for reliable local execution,
 * isolated testing, and fallback when cloud object storage credentials are not provided.
 */
class LocalPrivateStorageService implements StorageService {
  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (_err) {
      // Ignore if directory already exists
    }
  }

  private resolvePath(storageKey: string): string {
    // Prevent path traversal
    const safeKey = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, "");
    return path.join(STORAGE_ROOT_DIR, safeKey);
  }

  async putObject(params: {
    userId: string;
    filename: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<{ storageKey: string }> {
    const sanitizedFilename = path.basename(params.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageKey = `documents/${params.userId}/${randomUUID()}-${sanitizedFilename}`;
    const destinationPath = this.resolvePath(storageKey);

    await this.ensureDir(path.dirname(destinationPath));
    await fs.writeFile(destinationPath, params.buffer);

    logger.debug("Stored private document file", { storageKey, size: params.buffer.length });
    return { storageKey };
  }

  async getObject(storageKey: string): Promise<Buffer> {
    const filePath = this.resolvePath(storageKey);
    return await fs.readFile(filePath);
  }

  async deleteObject(storageKey: string): Promise<void> {
    const filePath = this.resolvePath(storageKey);
    try {
      await fs.unlink(filePath);
      logger.debug("Deleted private document file", { storageKey });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn("Failed to delete storage file", { storageKey, error: String(err) });
      }
    }
  }
}

export const storage: StorageService = new LocalPrivateStorageService();

/**
 * Utility for persisting a CV file selected on the landing page across
 * client navigation to /evaluations/new via IndexedDB with sessionStorage fallback.
 */

const DB_NAME = "coov_pending_uploads";
const STORE_NAME = "cv_cache";
const RECORD_KEY = "current_cv";
const SESSION_KEY = "coov_pending_cv_backup";

interface StoredCvRecord {
  name: string;
  type: string;
  lastModified: number;
  buffer: ArrayBuffer;
  targetRole?: string;
  savedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB not available"));
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persists a selected CV file and optional target role in IndexedDB (and sessionStorage).
 */
export async function savePendingCv(file: File, targetRole?: string): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const buffer = await file.arrayBuffer();
    const record: StoredCvRecord = {
      name: file.name,
      type: file.type || "application/pdf",
      lastModified: file.lastModified || Date.now(),
      buffer,
      targetRole: targetRole?.trim() || "",
      savedAt: Date.now(),
    };

    // 1. Primary: Save to IndexedDB (handles any file size up to 10MB+)
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (idbErr) {
      console.warn("IndexedDB storage failed, falling back to sessionStorage", idbErr);
    }

    // 2. Secondary fallback: sessionStorage (if under 3MB)
    if (typeof window.sessionStorage !== "undefined" && file.size < 3 * 1024 * 1024) {
      try {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        window.sessionStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            name: file.name,
            type: file.type,
            lastModified: file.lastModified,
            base64,
            targetRole: targetRole?.trim() || "",
            savedAt: Date.now(),
          })
        );
      } catch {
        // Ignore sessionStorage quota errors
      }
    }
  } catch (err) {
    console.error("Failed to save pending CV", err);
  }
}

/**
 * Retrieves the pending CV file and target role from IndexedDB or sessionStorage.
 */
export async function getPendingCv(): Promise<{ file: File; targetRole?: string } | null> {
  if (typeof window === "undefined") return null;

  // 1. Try IndexedDB
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
    const record = await new Promise<StoredCvRecord | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as StoredCvRecord);
      req.onerror = () => reject(req.error);
    });

    if (record && record.buffer) {
      // Discard if older than 2 hours
      if (Date.now() - (record.savedAt || 0) < 2 * 60 * 60 * 1000) {
        const file = new File([record.buffer], record.name, {
          type: record.type,
          lastModified: record.lastModified,
        });
        return { file, targetRole: record.targetRole };
      }
    }
  } catch {
    // Fall back to sessionStorage
  }

  // 2. Try sessionStorage fallback
  if (typeof window.sessionStorage !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.base64 && Date.now() - (parsed.savedAt || 0) < 2 * 60 * 60 * 1000) {
          const binary = atob(parsed.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const file = new File([bytes.buffer], parsed.name, {
            type: parsed.type,
            lastModified: parsed.lastModified,
          });
          return { file, targetRole: parsed.targetRole };
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return null;
}

/**
 * Clears pending CV data from both IndexedDB and sessionStorage.
 */
export async function clearPendingCv(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(RECORD_KEY);
  } catch {
    // Ignore
  }

  try {
    if (typeof window.sessionStorage !== "undefined") {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Ignore
  }
}

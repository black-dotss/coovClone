import { describe, it, expect, afterEach } from "vitest";
import { savePendingCv, getPendingCv, clearPendingCv } from "@/lib/client/pending-cv";

describe("Pending CV Transfer Utility", () => {
  const origWindow = globalThis.window;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = origWindow;
  });

  it("handles server-side environments safely without throwing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;

    const dummyFile = new File([Buffer.from("cv content")], "resume.pdf", {
      type: "application/pdf",
    });

    await expect(savePendingCv(dummyFile, "Software Engineer")).resolves.not.toThrow();
    const result = await getPendingCv();
    expect(result).toBeNull();
    await expect(clearPendingCv()).resolves.not.toThrow();
  });

  it("saves and retrieves pending CV via sessionStorage fallback", async () => {
    const storageMap = new Map<string, string>();
    const mockSessionStorage = {
      getItem: (key: string) => storageMap.get(key) || null,
      setItem: (key: string, val: string) => storageMap.set(key, val),
      removeItem: (key: string) => storageMap.delete(key),
      clear: () => storageMap.clear(),
      length: 0,
      key: () => null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {
      sessionStorage: mockSessionStorage,
      indexedDB: undefined,
    };

    const dummyFile = new File([Buffer.from("candidate resume text")], "Israel_CV.pdf", {
      type: "application/pdf",
      lastModified: 1700000000000,
    });

    await savePendingCv(dummyFile, "Senior Meta Engineer");

    const retrieved = await getPendingCv();
    expect(retrieved).not.toBeNull();
    expect(retrieved?.file.name).toBe("Israel_CV.pdf");
    expect(retrieved?.file.type).toBe("application/pdf");
    expect(retrieved?.targetRole).toBe("Senior Meta Engineer");

    const text = await retrieved?.file.text();
    expect(text).toBe("candidate resume text");

    await clearPendingCv();
    const afterClear = await getPendingCv();
    expect(afterClear).toBeNull();
  });
});

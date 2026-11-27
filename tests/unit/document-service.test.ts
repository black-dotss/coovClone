import { describe, it, expect, vi } from "vitest";
import { ForbiddenError } from "@/lib/shared/errors";

vi.mock("@/lib/db", () => {
  const mockDoc = {
    id: "doc-uuid-1",
    ownerUserId: "owner-user",
    type: "cv",
    filename: "resume.pdf",
    mimeType: "application/pdf",
    fileSize: 1024,
    checksum: "dummychecksum",
    privateStorageKey: "documents/owner-user/test.pdf",
    extractedText: "Software Developer Experience",
    extractedTextStatus: "completed",
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    db: {
      insert: () => ({
        values: () => ({
          returning: () => [mockDoc],
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => [mockDoc],
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => [mockDoc],
          }),
        }),
      }),
    },
    documents: {},
    cvVersions: {},
  };
});

vi.mock("@/lib/documents/storage", () => ({
  storage: {
    putObject: () => Promise.resolve({ storageKey: "documents/owner-user/test.pdf" }),
    getObject: () => Promise.resolve(Buffer.from("dummy")),
    deleteObject: () => Promise.resolve(),
  },
}));

import { getDocumentById, deleteDocumentById } from "@/lib/documents/service";

describe("Document Service and Ownership Authorization", () => {
  it("retrieves document when requesting user is the owner", async () => {
    const doc = await getDocumentById("doc-uuid-1", "owner-user");
    expect(doc.id).toBe("doc-uuid-1");
    expect(doc.ownerUserId).toBe("owner-user");
  });

  it("denies access with ForbiddenError when requesting user does not own the document", async () => {
    await expect(
      getDocumentById("doc-uuid-1", "other-unauthorized-user")
    ).rejects.toThrowError(ForbiddenError);
  });

  it("deletes document when requesting user is the owner", async () => {
    const result = await deleteDocumentById("doc-uuid-1", "owner-user");
    expect(result.success).toBe(true);
    expect(result.documentId).toBe("doc-uuid-1");
  });

  it("prevents deletion with ForbiddenError when caller is not the owner", async () => {
    await expect(
      deleteDocumentById("doc-uuid-1", "attacker")
    ).rejects.toThrowError(ForbiddenError);
  });
});

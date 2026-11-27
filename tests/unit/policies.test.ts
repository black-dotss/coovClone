import { describe, it, expect, vi } from "vitest";
import { ForbiddenError } from "@/lib/shared/errors";

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => [
          {
            id: "doc-123",
            ownerUserId: "real-owner",
            filename: "resume.pdf",
          },
        ],
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "mock-id" }]),
      }),
    }),
  },
  users: {},
  documents: {},
  devices: {},
  deviceTombstones: {},
  auditEvents: {},
}));

// Import policies after mock
import { deleteUserAccount, deleteUserDocument } from "@/lib/auth/policies";

describe("Account and Document Deletion Policies", () => {
  it("rejects account deletion if caller does not own the account", async () => {
    await expect(
      deleteUserAccount("target-user-123", "attacker-456")
    ).rejects.toThrowError(ForbiddenError);
  });

  it("allows account deletion if caller owns the account", async () => {
    const res = await deleteUserAccount("owner-123", "owner-123");
    expect(res.success).toBe(true);
    expect(res.deletedUserId).toBe("owner-123");
  });

  it("rejects document deletion if caller does not own the document", async () => {
    await expect(
      deleteUserDocument("doc-123", "unauthorized-user")
    ).rejects.toThrowError(ForbiddenError);
  });

  it("allows document deletion if caller owns the document", async () => {
    const res = await deleteUserDocument("doc-123", "real-owner");
    expect(res.success).toBe(true);
    expect(res.documentId).toBe("doc-123");
  });
});

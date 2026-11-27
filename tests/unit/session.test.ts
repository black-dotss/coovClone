import { describe, it, expect } from "vitest";
import { assertOwnership, requireAuth, getSession } from "@/lib/auth/session";
import { ForbiddenError, UnauthorizedError } from "@/lib/shared/errors";

describe("Session Helpers and Ownership Authorization", () => {
  describe("assertOwnership", () => {
    it("allows access when current user is the resource owner", () => {
      expect(() => {
        assertOwnership("user-123", "user-123", "document");
      }).not.toThrow();
    });

    it("throws ForbiddenError with descriptive message when user is not the owner", () => {
      expect(() => {
        assertOwnership("owner-abc", "attacker-xyz", "evaluation");
      }).toThrowError(ForbiddenError);

      try {
        assertOwnership("owner-abc", "attacker-xyz", "evaluation");
      } catch (err) {
        expect((err as ForbiddenError).code).toBe("FORBIDDEN");
        expect((err as ForbiddenError).statusCode).toBe(403);
        expect((err as ForbiddenError).message).toContain("evaluation");
      }
    });

    it("throws ForbiddenError if owner ID or current user ID is empty", () => {
      expect(() => assertOwnership("", "user-123")).toThrowError(ForbiddenError);
      expect(() => assertOwnership("user-123", "")).toThrowError(ForbiddenError);
    });
  });

  describe("requireAuth", () => {
    it("throws UnauthorizedError when no session cookie or token is provided", async () => {
      const emptyHeaders = new Headers();
      await expect(requireAuth(emptyHeaders)).rejects.toThrowError(UnauthorizedError);
    });

    it("returns null when getSession is called with empty headers", async () => {
      const emptyHeaders = new Headers();
      const session = await getSession(emptyHeaders);
      expect(session).toBeNull();
    });
  });
});

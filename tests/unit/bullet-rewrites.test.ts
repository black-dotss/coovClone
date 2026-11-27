import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/lib/shared/errors";
import { evaluations, cvVersions, rewriteSuggestions } from "@/lib/db/schema";
import {
  createTruthfulBulletRewrite,
  verifyTruthfulRewrite,
  generateBulletRewrites,
  listBulletRewrites,
  toggleAcceptRewrite,
} from "@/lib/reports/rewrites";

const mockEvaluation = {
  id: "eval-rewrite-test-1",
  ownerUserId: "user-owner-1",
  cvVersionId: "cv-v1",
  status: "completed",
};

const mockCv = {
  id: "cv-v1",
  extractedText: "Alex Doe\n- Responsible for building REST APIs with PostgreSQL.\n- Worked on team bug tracker.",
};

const mockExistingRewrite = {
  id: "rew-1",
  evaluationId: "eval-rewrite-test-1",
  originalText: "Responsible for building REST APIs with PostgreSQL",
  suggestedText: "Engineered and maintained REST APIs with PostgreSQL.",
  explanation: "Replaced passive responsibility phrasing with active engineering ownership",
  isAccepted: false,
  createdAt: new Date(),
  ownerUserId: "user-owner-1",
};

let inMemoryRewrites: Record<string, unknown>[] = [];

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => Promise.resolve(data.slice(0, n)),
    orderBy: () => createMockQuery(data),
    where: () => createMockQuery(data),
    innerJoin: () => createMockQuery(data),
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === evaluations) return createMockQuery([mockEvaluation]);
        if (table === cvVersions) return createMockQuery([mockCv]);
        if (table === rewriteSuggestions) return createMockQuery(inMemoryRewrites);
        return createMockQuery([]);
      },
    }),
    insert: () => ({
      values: (val: Record<string, unknown>) => {
        const record = { id: `rew-${Date.now()}`, ...val, createdAt: new Date() };
        inMemoryRewrites.push(record);
        return {
          returning: () => [record],
        };
      },
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          if (inMemoryRewrites.length > 0) {
            Object.assign(inMemoryRewrites[0], updates);
          }
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => {
        inMemoryRewrites = inMemoryRewrites.filter((r) => r.isAccepted === true);
        return Promise.resolve();
      },
    }),
  },
}));

describe("Truthful Bullet Rewrites and Anti-Hallucination Guard", () => {
  beforeEach(() => {
    inMemoryRewrites = [{ ...mockExistingRewrite }];
    vi.clearAllMocks();
  });

  describe("Anti-Hallucination & Truthfulness Verification", () => {
    it("approves rewrites that strengthen verbs without fabricating metrics", () => {
      const original = "Responsible for building REST APIs with PostgreSQL";
      const rewrite = "Engineered and maintained REST APIs with PostgreSQL.";

      const check = verifyTruthfulRewrite(original, rewrite);
      expect(check.isTruthful).toBe(true);
      expect(check.ungroundedClaims).toHaveLength(0);
    });

    it("catches and flags ungrounded metric claims that did not exist in candidate source", () => {
      const original = "Worked on database performance";
      const hallucinatedRewrite = "Optimized database performance, reducing latency by 85% and saving $2M annually.";

      const check = verifyTruthfulRewrite(original, hallucinatedRewrite);
      expect(check.isTruthful).toBe(false);
      expect(check.ungroundedClaims).toContain("85%");
    });

    it("allows metric claims if they were already present in original candidate text", () => {
      const original = "Reduced query latency by 40% across 5000 users";
      const validRewrite = "Architected query optimization pipeline, reducing latency by 40% across 5000 users.";

      const check = verifyTruthfulRewrite(original, validRewrite);
      expect(check.isTruthful).toBe(true);
      expect(check.ungroundedClaims).toHaveLength(0);
    });

    it("transforms passive responsibility starters into active engineering verbs", () => {
      const res1 = createTruthfulBulletRewrite("Responsible for development of authentication service");
      expect(res1.suggestedText).toContain("Engineered and maintained authentication service");

      const res2 = createTruthfulBulletRewrite("Worked on database indexing");
      expect(res2.suggestedText).toContain("Architected and delivered database indexing");

      const res3 = createTruthfulBulletRewrite("Helped build CI/CD pipeline");
      expect(res3.suggestedText).toContain("Collaborated to implement and optimize CI/CD pipeline");
    });
  });

  describe("Rewrite Generation and Persistence", () => {
    it("generates truthful rewrites, persists to database, and enforces ownership", async () => {
      const rewrites = await generateBulletRewrites(
        "eval-rewrite-test-1",
        "user-owner-1",
        {
          customBullets: ["Responsible for writing unit tests for payment system."],
        }
      );

      expect(rewrites.length).toBeGreaterThanOrEqual(1);
      expect(rewrites[0].suggestedText).toContain("Engineered");
      expect(rewrites[0].isAccepted).toBe(false);
    });

    it("rejects unauthorized users with ForbiddenError", async () => {
      await expect(
        generateBulletRewrites("eval-rewrite-test-1", "unauthorized-user-456")
      ).rejects.toThrow(ForbiddenError);
    });

    it("lists all saved bullet rewrites for the owner", async () => {
      const list = await listBulletRewrites("eval-rewrite-test-1", "user-owner-1");
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0].originalText).toContain("Responsible for building");
    });

    it("allows owner to toggle acceptance of a suggested rewrite", async () => {
      const updated = await toggleAcceptRewrite("rew-1", "user-owner-1", true);
      expect(updated.isAccepted).toBe(true);
    });

    it("prohibits non-owners from toggling acceptance", async () => {
      await expect(
        toggleAcceptRewrite("rew-1", "attacker-999", true)
      ).rejects.toThrow(ForbiddenError);
    });
  });
});

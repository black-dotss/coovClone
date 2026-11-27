import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, BadRequestError } from "@/lib/shared/errors";
import { cvVersions, jobDescriptions } from "@/lib/db/schema";
import { compareCvWithJobDescriptions } from "@/lib/reports/comparisons";

const mockCv = {
  id: "cv-v1",
  userId: "user-owner-1",
  extractedText: `Alex Doe
Senior Backend Engineer
Experience:
- 5+ years building backend systems with TypeScript, Node.js, and PostgreSQL.
- Architected RESTful and GraphQL APIs for financial data processing.
- Configured Docker and Redis for caching and fast throughput.`,
};

const mockJd1 = {
  id: "jd-1",
  userId: "user-owner-1",
  title: "Senior Backend Engineer",
  company: "Stripe",
  rawText: `Requirements:
- 4+ years TypeScript, Node.js, and PostgreSQL.
- Experience with API design and distributed systems.`,
};

const mockJd2 = {
  id: "jd-2",
  userId: "user-owner-1",
  title: "DevOps / Infrastructure Engineer",
  company: "CloudScale",
  rawText: `Requirements:
- 5+ years Kubernetes, Terraform, AWS, and Prometheus monitoring.
- Go and Python scripting.`,
};

const mockJd3 = {
  id: "jd-3",
  userId: "user-owner-1",
  title: "Full Stack Engineer",
  company: "Vercel",
  rawText: `Requirements:
- React, Next.js, TypeScript, and CSS.
- PostgreSQL and Node.js.`,
};

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => Promise.resolve(data.slice(0, n)),
    orderBy: () => createMockQuery(data),
    where: () => createMockQuery(data),
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === cvVersions) return createMockQuery([mockCv]);
        if (table === jobDescriptions) return createMockQuery([mockJd1, mockJd2, mockJd3]);
        return createMockQuery([]);
      },
    }),
  },
}));

describe("One-CV-to-Three-JD Comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Input Validation & Range Constraints", () => {
    it("rejects comparison requests with fewer than 2 job descriptions", async () => {
      await expect(
        compareCvWithJobDescriptions("user-owner-1", {
          cvVersionId: "cv-v1",
          jobDescriptionIds: ["jd-1"],
        })
      ).rejects.toThrow(BadRequestError);
    });

    it("rejects comparison requests with more than 3 job descriptions", async () => {
      await expect(
        compareCvWithJobDescriptions("user-owner-1", {
          cvVersionId: "cv-v1",
          jobDescriptionIds: ["jd-1", "jd-2", "jd-3", "jd-4"],
        })
      ).rejects.toThrow(BadRequestError);
    });

    it("rejects requests containing duplicate job description IDs", async () => {
      await expect(
        compareCvWithJobDescriptions("user-owner-1", {
          cvVersionId: "cv-v1",
          jobDescriptionIds: ["jd-1", "jd-1"],
        })
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe("Scoring Consistency, Ranking, and Recommendations", () => {
    it("evaluates CV against 2 or 3 JDs using identical rubrics, accurately ranking the best fit", async () => {
      const result = await compareCvWithJobDescriptions("user-owner-1", {
        cvVersionId: "cv-v1",
        jobDescriptionIds: ["jd-1", "jd-2", "jd-3"],
      });

      expect(result.cvVersionId).toBe("cv-v1");
      expect(result.roles).toHaveLength(3);

      // Verify roles are ranked 1, 2, 3
      expect(result.roles.map((r) => r.rank)).toEqual([1, 2, 3]);

      // Since the CV is heavily Backend (TypeScript/PostgreSQL), Senior Backend Engineer at Stripe should be #1
      const bestRole = result.roles[0];
      expect(bestRole.title).toBe("Senior Backend Engineer");
      expect(bestRole.company).toBe("Stripe");
      expect(bestRole.overallScore).toBeGreaterThan(result.roles[1].overallScore);

      // Verify recommendation
      expect(result.recommendedRole.title).toBe("Senior Backend Engineer");
      expect(result.recommendedRole.reason).toContain("Highest composite match");
      expect(result.comparisonSummary).toContain("Candidate is strongest fit for");
    });
  });

  describe("Ownership Authorization", () => {
    it("rejects callers who do not own the CV version with ForbiddenError", async () => {
      await expect(
        compareCvWithJobDescriptions("attacker-999", {
          cvVersionId: "cv-v1",
          jobDescriptionIds: ["jd-1", "jd-2"],
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects callers who do not own one of the job descriptions", async () => {
      const { db } = await import("@/lib/db");
      vi.spyOn(db, "select").mockImplementationOnce(() => ({
        from: () => createMockQuery([mockCv]),
      } as unknown as ReturnType<typeof db.select>));

      vi.spyOn(db, "select").mockImplementationOnce(() => ({
        from: () =>
          createMockQuery([
            mockJd1,
            { ...mockJd2, userId: "another-owner-999" },
          ]),
      } as unknown as ReturnType<typeof db.select>));

      await expect(
        compareCvWithJobDescriptions("user-owner-1", {
          cvVersionId: "cv-v1",
          jobDescriptionIds: ["jd-1", "jd-2"],
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });
});

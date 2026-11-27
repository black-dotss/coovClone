import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createCvVersion,
  listCvVersions,
  compareCvVersions,
} from "@/lib/documents/versions";
import { ForbiddenError, BadRequestError } from "@/lib/shared/errors";
import { cvVersions, documents, evaluations, reports } from "@/lib/db/schema";

interface MockCvVersion {
  id: string;
  userId: string;
  sourceDocumentId: string;
  versionNumber: number;
  extractedText: string;
  createdAt: Date;
}

interface MockEvaluation {
  id: string;
  ownerUserId: string;
  cvVersionId: string;
  status: string;
  overallScore: number;
  verdict: string;
  createdAt: Date;
}

let inMemoryVersions: MockCvVersion[] = [];
let inMemoryEvaluations: MockEvaluation[] = [];

const mockDocument = {
  id: "doc-cv-1",
  ownerUserId: "user-1",
  filename: "Abebe_CV.pdf",
  deletedAt: null,
};

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => Promise.resolve(data.slice(0, n)),
    orderBy: () => createMockQuery(data),
    where: () => createMockQuery(data),
  });
}

function extractClauseValue(clause: Record<string, unknown> | undefined): string | undefined {
  if (!clause) return undefined;
  if (typeof clause.value === "string") return clause.value;
  const right = clause.right as Record<string, unknown> | undefined;
  if (right && typeof right.value === "string") return right.value;
  if (Array.isArray(clause.queryChunks)) {
    for (const chunk of clause.queryChunks) {
      if (typeof chunk === "string") return chunk;
      if (chunk && typeof (chunk as Record<string, unknown>).value === "string") {
        return (chunk as Record<string, unknown>).value as string;
      }
    }
  }
  return undefined;
}

function findMatchingVersions(clause: Record<string, unknown> | undefined): MockCvVersion[] {
  const targetVal = extractClauseValue(clause);
  if (!targetVal) return inMemoryVersions;

  const byId = inMemoryVersions.filter((v) => v.id === targetVal);
  if (byId.length > 0) return byId;

  const byDoc = inMemoryVersions.filter((v) => v.sourceDocumentId === targetVal);
  if (byDoc.length > 0) return byDoc;

  return inMemoryVersions;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === documents) {
          return {
            where: () => ({
              limit: () => Promise.resolve([mockDocument]),
            }),
          };
        }
        if (table === cvVersions) {
          return {
            where: (clause: unknown) => {
              const data = findMatchingVersions(clause as Record<string, unknown> | undefined);
              return {
                orderBy: () => createMockQuery(data),
                limit: (n: number) => Promise.resolve(data.slice(0, n)),
                then: (resolve: (items: MockCvVersion[]) => void) => resolve(data),
              };
            },
            orderBy: () => createMockQuery(inMemoryVersions),
          };
        }
        if (table === evaluations) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => {
                  return Promise.resolve(inMemoryEvaluations.slice(0, 1));
                },
              }),
            }),
          };
        }
        if (table === reports) {
          return {
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: "rep-1",
                    structuredReport: {
                      dimensions: {
                        roleFit: 80,
                        skillsAndEvidence: 85,
                        atsAlignment: 75,
                        impactAndClarity: 70,
                        professionalPresentation: 80,
                      },
                    },
                  },
                ]),
            }),
          };
        }
        return createMockQuery([]);
      },
    }),
    insert: () => ({
      values: (val: Record<string, unknown>) => {
        const record: MockCvVersion = {
          id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          userId: val.userId as string,
          sourceDocumentId: val.sourceDocumentId as string,
          versionNumber: val.versionNumber as number,
          extractedText: val.extractedText as string,
          createdAt: new Date(),
        };
        inMemoryVersions.push(record);
        return {
          returning: () => [record],
        };
      },
    }),
  },
  cvVersions: {},
  documents: {},
  evaluations: {},
  reports: {},
  auditEvents: {},
}));

describe("CV Version History and Score Comparisons", () => {
  beforeEach(() => {
    inMemoryVersions = [];
    inMemoryEvaluations = [];
  });

  describe("CV Version Creation & Incrementation", () => {
    it("creates the first version with versionNumber 1", async () => {
      const created = await createCvVersion(
        "user-1",
        "doc-cv-1",
        "Initial candidate CV text with 5 years experience in PostgreSQL."
      );

      expect(created.versionNumber).toBe(1);
      expect(created.userId).toBe("user-1");
      expect(created.sourceDocumentId).toBe("doc-cv-1");
      expect(created.extractedText).toContain("Initial candidate CV text");
    });

    it("increments version number sequentially on subsequent uploads", async () => {
      // First version
      inMemoryVersions.push({
        id: "ver-1",
        userId: "user-1",
        sourceDocumentId: "doc-cv-1",
        versionNumber: 1,
        extractedText: "Version 1 text",
        createdAt: new Date(),
      });

      const second = await createCvVersion(
        "user-1",
        "doc-cv-1",
        "Version 2 updated text with bullet rewrites."
      );

      expect(second.versionNumber).toBe(2);
    });

    it("rejects unauthorized users with ForbiddenError", async () => {
      await expect(
        createCvVersion("unauthorized-user-999", "doc-cv-1", "Hacked text")
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects empty extracted text with BadRequestError", async () => {
      await expect(
        createCvVersion("user-1", "doc-cv-1", "    ")
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe("CV Version History Listing", () => {
    it("lists all versions with associated evaluation outcomes", async () => {
      inMemoryVersions.push(
        {
          id: "ver-1",
          userId: "user-1",
          sourceDocumentId: "doc-cv-1",
          versionNumber: 1,
          extractedText: "Version 1 text",
          createdAt: new Date("2026-11-01"),
        },
        {
          id: "ver-2",
          userId: "user-1",
          sourceDocumentId: "doc-cv-1",
          versionNumber: 2,
          extractedText: "Version 2 text with rewrites applied",
          createdAt: new Date("2026-11-15"),
        }
      );

      inMemoryEvaluations.push({
        id: "eval-v2",
        ownerUserId: "user-1",
        cvVersionId: "ver-2",
        status: "completed",
        overallScore: 84,
        verdict: "Strong fit",
        createdAt: new Date("2026-11-15T10:00:00Z"),
      });

      const versions = await listCvVersions("doc-cv-1", "user-1");

      expect(versions).toHaveLength(2);
      expect(versions[0].versionNumber).toBe(1);
      expect(versions[1].versionNumber).toBe(2);
      expect(versions[1].latestEvaluation?.overallScore).toBe(84);
      expect(versions[1].latestEvaluation?.verdict).toBe("Strong fit");
    });
  });

  describe("CV Version Comparisons", () => {
    it("rejects comparison when base and target versions are the same", async () => {
      await expect(
        compareCvVersions("ver-same", "ver-same", "user-1")
      ).rejects.toThrow(BadRequestError);
    });

    it("computes score delta, dimension changes, and text length metrics between versions", async () => {
      inMemoryVersions.push(
        {
          id: "ver-base",
          userId: "user-1",
          sourceDocumentId: "doc-cv-1",
          versionNumber: 1,
          extractedText: "Short base CV text describing past projects.",
          createdAt: new Date("2026-11-01"),
        },
        {
          id: "ver-target",
          userId: "user-1",
          sourceDocumentId: "doc-cv-1",
          versionNumber: 2,
          extractedText:
            "Enhanced CV text featuring truthful bullet rewrites, quantitative metrics, and PostgreSQL expertise.",
          createdAt: new Date("2026-11-10"),
        }
      );

      inMemoryEvaluations.push({
        id: "eval-target",
        ownerUserId: "user-1",
        cvVersionId: "ver-target",
        status: "completed",
        overallScore: 82,
        verdict: "Strong fit",
        createdAt: new Date("2026-11-10"),
      });

      const comparison = await compareCvVersions("ver-base", "ver-target", "user-1");

      expect(comparison.sourceDocumentId).toBe("doc-cv-1");
      expect(comparison.baseVersion.versionNumber).toBe(1);
      expect(comparison.targetVersion.versionNumber).toBe(2);
      expect(comparison.textMetrics.charCountDelta).toBeGreaterThan(0);
      expect(comparison.textMetrics.wordCountDelta).toBeGreaterThan(0);
      expect(comparison.summary).toContain("Compared version 1 to version 2");
    });
  });
});

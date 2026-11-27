import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, NotFoundError, BadRequestError } from "@/lib/shared/errors";
import { evaluations, reports } from "@/lib/db/schema";

const mockEvaluation = {
  id: "eval-report-test-1",
  ownerUserId: "user-owner-1",
  cvVersionId: "cv-v1",
  jobDescriptionId: "jd-1",
  tone: "strict",
  status: "completed",
  overallScore: 82.5,
  verdict: "Potential fit",
  workflowState: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockStructuredReport = {
  overallScore: 82.5,
  verdict: "Potential fit",
  confidence: 0.92,
  explanation: "Strong technical alignment with minor ATS phrasing gaps.",
  dimensions: {
    roleFit: 85,
    skillsAndEvidence: 88,
    atsAlignment: 75,
    impactAndClarity: 80,
    professionalPresentation: 82,
  },
  strengths: ["Solid PostgreSQL backend architecture", "TypeScript type safety"],
  weaknesses: ["Missing cloud deployment metrics"],
  prioritizedFixes: [
    {
      fix: "Add measurable impact to database migration bullet",
      expectedBenefit: "Demonstrates production scale",
      effort: "low",
    },
  ],
  redFlags: [],
  likelyInterviewQuestions: [
    {
      question: "How did you optimize your PostgreSQL queries under high concurrency?",
      tiedToClaim: "Built TypeScript APIs with PostgreSQL",
      rationale: "Probes database indexing and performance tuning depth",
    },
  ],
  atsSummary: {
    keywordCoverage: 78,
    matched: ["TypeScript", "PostgreSQL"],
    partial: ["Node.js"],
    missing: ["Kubernetes"],
    disclaimer: "ATS alignment reflects keyword coverage, not overall suitability.",
  },
  uncertaintyNotes: [],
};

const mockReportRecord = {
  id: "rep-1",
  evaluationId: "eval-report-test-1",
  structuredReport: mockStructuredReport,
  pdfStorageKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => Promise.resolve(data.slice(0, n)),
    orderBy: () => createMockQuery(data),
    where: () => createMockQuery(data),
  });
}

let inMemoryEval = { ...mockEvaluation };
let inMemoryReport: typeof mockReportRecord | null = { ...mockReportRecord };

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === evaluations) return createMockQuery([inMemoryEval]);
        if (table === reports) return createMockQuery(inMemoryReport ? [inMemoryReport] : []);
        return createMockQuery([]);
      },
    }),
  },
}));

import { getEvaluationReport } from "@/lib/reports/service";

describe("Evaluation Reports Service", () => {
  beforeEach(() => {
    inMemoryEval = { ...mockEvaluation, status: "completed" };
    inMemoryReport = { ...mockReportRecord };
    vi.clearAllMocks();
  });

  it("retrieves the full structured evaluation report when caller owns the evaluation", async () => {
    const report = await getEvaluationReport("eval-report-test-1", "user-owner-1");

    expect(report.evaluationId).toBe("eval-report-test-1");
    expect(report.overallScore).toBe(82.5);
    expect(report.verdict).toBe("Potential fit");
    expect(report.confidence).toBe(0.92);
    expect(report.dimensions.skillsAndEvidence).toBe(88);
    expect(report.strengths).toContain("Solid PostgreSQL backend architecture");
    expect(report.likelyInterviewQuestions).toHaveLength(1);
    expect(report.disclaimer).toContain("CookMyCv recruitment simulation assessment");
  });

  it("denies access with ForbiddenError when caller does not own the evaluation", async () => {
    await expect(
      getEvaluationReport("eval-report-test-1", "attacker-user-999")
    ).rejects.toThrow(ForbiddenError);
  });

  it("throws BadRequestError if the evaluation is still in queued or processing status", async () => {
    inMemoryEval.status = "processing";
    inMemoryReport = null;

    await expect(
      getEvaluationReport("eval-report-test-1", "user-owner-1")
    ).rejects.toThrow(BadRequestError);
  });

  it("throws NotFoundError when evaluation does not exist", async () => {
    const { db } = await import("@/lib/db");
    vi.spyOn(db, "select").mockReturnValueOnce({
      from: () => createMockQuery([]),
    } as unknown as ReturnType<typeof db.select>);

    await expect(
      getEvaluationReport("non-existent-id", "user-owner-1")
    ).rejects.toThrow(NotFoundError);
  });
});

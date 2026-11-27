import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, BadRequestError } from "@/lib/shared/errors";
import { evaluations } from "@/lib/db/schema";
import {
  submitDefense,
  listDefenses,
  calculateBoundedReassessment,
} from "@/lib/reports/defense";

const mockEvaluation = {
  id: "eval-defense-test-1",
  ownerUserId: "user-owner-1",
  status: "completed",
  overallScore: 65,
  verdict: "Potential fit",
  workflowState: {
    defenseRevisions: [],
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

let currentEval = { ...mockEvaluation };

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
        if (table === evaluations) return createMockQuery([currentEval]);
        return createMockQuery([]);
      },
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          Object.assign(currentEval, updates);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

describe("Defend-Yourself Submissions and Bounded Reassessment", () => {
  beforeEach(() => {
    currentEval = {
      ...mockEvaluation,
      overallScore: 65,
      workflowState: { defenseRevisions: [] },
    };
    vi.clearAllMocks();
  });

  describe("Bounded Scoring Calculation", () => {
    it("adjusts score within strictly bounded limits (+3 to +8 points)", () => {
      const { scoreDelta, rationale } = calculateBoundedReassessment(
        {
          claimOrFlag: "Missing AWS deployment metrics",
          defenseText:
            "I managed production AWS ECS deployments and Terraform scripts at my previous role for 2 years.",
          supportingEvidence: "github.com/alexdoe/infra-terraform",
        },
        65,
        0
      );

      expect(scoreDelta).toBeGreaterThanOrEqual(3);
      expect(scoreDelta).toBeLessThanOrEqual(8);
      expect(rationale).toContain("Candidate provided credible clarification");
    });

    it("enforces cumulative ceiling: cannot exceed +15 total score delta across revisions", () => {
      // If candidate already received +13 points from prior defenses
      const res = calculateBoundedReassessment(
        {
          claimOrFlag: "Another minor criticism",
          defenseText: "Detailed explanation of testing methodologies with comprehensive unit tests.",
        },
        78,
        13 // 13 points already granted
      );

      // Remaining allowance is only 15 - 13 = 2 points
      expect(res.scoreDelta).toBe(2);

      // When 15 points already reached:
      const maxedOut = calculateBoundedReassessment(
        {
          claimOrFlag: "Third criticism",
          defenseText: "Another substantive paragraph explaining architectural designs.",
        },
        80,
        15
      );

      expect(maxedOut.scoreDelta).toBe(0);
      expect(maxedOut.rationale).toContain("maximum cumulative reassessment cap");
    });

    it("rejects trivial or empty defenses with BadRequestError", () => {
      expect(() =>
        calculateBoundedReassessment(
          {
            claimOrFlag: "Missing skill",
            defenseText: "I know it", // < 10 chars
          },
          65,
          0
        )
      ).toThrow(BadRequestError);
    });

    it("awards 0 points when candidate provides weak or unsubstantiated excuses", () => {
      const { scoreDelta, rationale } = calculateBoundedReassessment(
        {
          claimOrFlag: "Missing PostgreSQL indexing",
          defenseText: "I know it well and trust me I can learn it quickly.",
        },
        65,
        0
      );

      expect(scoreDelta).toBe(0);
      expect(rationale).toContain("insufficient to adjust composite score");
    });
  });

  describe("Defense Persistence and Report Preservation", () => {
    it("submits defense, updates evaluation composite score, and preserves original report", async () => {
      const revision = await submitDefense("eval-defense-test-1", "user-owner-1", {
        claimOrFlag: "Missing Kubernetes experience",
        defenseText:
          "My team used Docker Compose and EKS internally; the summary CV simply condensed the cloud tooling list.",
        supportingEvidence: "production EKS cluster helm charts",
      });

      expect(revision.revisionNumber).toBe(1);
      expect(revision.scoreDelta).toBeGreaterThanOrEqual(3);
      expect(revision.newScore).toBe(65 + revision.scoreDelta);
      expect(revision.claimOrFlag).toBe("Missing Kubernetes experience");

      // Verify state was saved to evaluation
      expect(currentEval.overallScore).toBe(revision.newScore);
      expect(currentEval.workflowState.defenseRevisions).toHaveLength(1);
    });

    it("lists defense history for the evaluation owner", async () => {
      await submitDefense("eval-defense-test-1", "user-owner-1", {
        claimOrFlag: "Gaps in testing",
        defenseText: "Maintained 90% unit test coverage across all microservices using Jest.",
      });

      const revisions = await listDefenses("eval-defense-test-1", "user-owner-1");
      expect(revisions).toHaveLength(1);
      expect(revisions[0].claimOrFlag).toBe("Gaps in testing");
    });

    it("prohibits unauthorized users from defending someone else's evaluation", async () => {
      await expect(
        submitDefense("eval-defense-test-1", "attacker-999", {
          claimOrFlag: "Some claim",
          defenseText: "Substantive explanation that is long enough.",
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });
});

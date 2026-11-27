import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createShareLink,
  revokeShareLink,
  getSharedReportByToken,
  hashShareToken,
} from "@/lib/reports/share";
import { redactPersonalInformation, redactStructuredReport } from "@/lib/reports/redaction";
import { ForbiddenError } from "@/lib/shared/errors";
import { StructuredEvaluationReport } from "@/lib/reports/types";
import { reports } from "@/lib/db/schema";

// In-memory mock databases for testing
interface MockShareLink {
  id: string;
  reportId: string;
  tokenHash: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  accessCount: number;
  createdAt: Date;
}

const inMemoryShareLinks: MockShareLink[] = [];
const inMemoryAuditEvents: Record<string, unknown>[] = [];

const mockReportData: StructuredEvaluationReport = {
  id: "rep-share-1",
  evaluationId: "eval-share-1",
  overallScore: 78,
  verdict: "Potential fit",
  confidence: 0.88,
  explanation: "Contact candidate at candidate@ethio.com or 0911223344. Portfolio: https://github.com/ethio-dev",
  dimensions: {
    roleFit: 75,
    skillsAndEvidence: 80,
    atsAlignment: 72,
    impactAndClarity: 82,
    professionalPresentation: 78,
  },
  strengths: ["Strong problem solving. Contact reference: ref@company.com"],
  weaknesses: ["Call +251 912345678 for details on gap in 2024."],
  prioritizedFixes: [
    {
      fix: "Add GitHub portfolio link https://portfolio.et to CV header",
      expectedBenefit: "Showcases verified code samples",
      effort: "low",
    },
  ],
  redFlags: [],
  likelyInterviewQuestions: [
    {
      question: "Explain your experience at previous company",
      tiedToClaim: "Reach out to manager at 0922334455",
      rationale: "Verifies leadership claim",
    },
  ],
  atsSummary: {
    keywordCoverage: 75,
    matched: ["TypeScript"],
    partial: [],
    missing: ["AWS"],
    disclaimer: "ATS disclaimer",
  },
  uncertaintyNotes: [],
  disclaimer: "CookMyCV recruitment simulation assessment.",
  createdAt: new Date("2026-11-16T10:00:00Z"),
  updatedAt: new Date("2026-11-16T10:00:00Z"),
};

function createUniversalQuery(isReportQuery: boolean) {
  const getRecord = () => {
    if (isReportQuery) {
      return [
        {
          reportId: "rep-share-1",
          evaluationId: "eval-share-1",
          ownerUserId: "owner-user-1",
        },
      ];
    }
    const found = inMemoryShareLinks[0];
    if (!found) return [];
    return [
      {
        id: found.id,
        reportId: found.reportId,
        tokenHash: found.tokenHash,
        expiresAt: found.expiresAt,
        revokedAt: found.revokedAt,
        accessCount: found.accessCount,
        createdAt: found.createdAt,
        reportStructured: mockReportData,
        reportCreatedAt: mockReportData.createdAt,
        reportUpdatedAt: mockReportData.updatedAt,
        evaluationId: mockReportData.evaluationId,
        ownerUserId: "owner-user-1",
      },
    ];
  };

  const builder: Record<string, unknown> = {
    innerJoin: () => builder,
    where: () => builder,
    limit: () => Promise.resolve(getRecord()),
    orderBy: () => builder,
    then: (resolve: (val: unknown) => void) => resolve(getRecord()),
  };
  return builder;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        // reports is used to check report ownership in createShareLink
        const isReportQuery = table === reports;
        return createUniversalQuery(isReportQuery);
      },
    }),
    insert: () => ({
      values: (val: Record<string, unknown>) => {
        if ("tokenHash" in val) {
          const record: MockShareLink = {
            id: `sl-${Date.now()}`,
            reportId: val.reportId as string,
            tokenHash: val.tokenHash as string,
            expiresAt: (val.expiresAt as Date) ?? null,
            revokedAt: null,
            accessCount: 0,
            createdAt: new Date(),
          };
          inMemoryShareLinks.push(record);
          return {
            returning: () => [record],
          };
        }
        const auditRecord = { id: `audit-${Date.now()}`, ...val, createdAt: new Date() };
        inMemoryAuditEvents.push(auditRecord);
        return {
          returning: () => [auditRecord],
        };
      },
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          if (inMemoryShareLinks.length > 0) {
            const item = inMemoryShareLinks[0];
            if (updates.revokedAt !== undefined) {
              item.revokedAt = updates.revokedAt as Date;
            }
            if (updates.accessCount !== undefined) {
              item.accessCount++;
            }
          }
          return Promise.resolve();
        },
      }),
    }),
  },
}));

describe("Share Links and Personal Details Redaction", () => {
  beforeEach(() => {
    inMemoryShareLinks.length = 0;
    inMemoryAuditEvents.length = 0;
  });

  describe("Contact Information Redaction", () => {
    it("redacts emails, Ethiopian phone numbers, and URLs from raw text", () => {
      const text =
        "Email me at user@example.com or call 0911223344 or +251 912345678. Visit https://linkedin.com/in/test";
      const sanitized = redactPersonalInformation(text);

      expect(sanitized).not.toContain("user@example.com");
      expect(sanitized).not.toContain("0911223344");
      expect(sanitized).not.toContain("+251 912345678");
      expect(sanitized).not.toContain("https://linkedin.com/in/test");

      expect(sanitized).toContain("[REDACTED EMAIL]");
      expect(sanitized).toContain("[REDACTED PHONE]");
      expect(sanitized).toContain("[REDACTED URL]");
    });

    it("redacts personal contact details across all structured report sections", () => {
      const sanitizedReport = redactStructuredReport(mockReportData);

      expect(sanitizedReport.explanation).toContain("[REDACTED EMAIL]");
      expect(sanitizedReport.explanation).toContain("[REDACTED PHONE]");
      expect(sanitizedReport.explanation).toContain("[REDACTED URL]");
      expect(sanitizedReport.strengths[0]).toContain("[REDACTED EMAIL]");
      expect(sanitizedReport.weaknesses[0]).toContain("[REDACTED PHONE]");
      expect(sanitizedReport.prioritizedFixes[0].fix).toContain("[REDACTED URL]");
      expect(sanitizedReport.likelyInterviewQuestions[0].tiedToClaim).toContain("[REDACTED PHONE]");
    });
  });

  describe("Share Link Creation and Hashing", () => {
    it("creates a share link and stores only the SHA-256 hash in database", async () => {
      const created = await createShareLink("rep-share-1", "owner-user-1", {
        expiresInDays: 7,
      });

      expect(created.token).toHaveLength(64); // 32 bytes hex = 64 chars
      expect(created.tokenHash).toBe(hashShareToken(created.token));
      expect(created.shareUrl).toBe(`/share/${created.token}`);
      expect(created.expiresAt).toBeInstanceOf(Date);

      // Verify the in-memory DB stored ONLY tokenHash, never raw token
      expect(inMemoryShareLinks).toHaveLength(1);
      expect(inMemoryShareLinks[0].tokenHash).toBe(created.tokenHash);
      expect((inMemoryShareLinks[0] as unknown as { token?: string }).token).toBeUndefined();
    });

    it("rejects unauthorized users from creating share links for others' reports", async () => {
      await expect(
        createShareLink("rep-share-1", "stranger-user-999")
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("Share Link Access, Expiration, and Revocation", () => {
    it("retrieves shared report by raw token and redacts personal details by default", async () => {
      const created = await createShareLink("rep-share-1", "owner-user-1");
      const shared = await getSharedReportByToken(created.token);

      expect(shared.report.overallScore).toBe(78);
      expect(shared.report.verdict).toBe("Potential fit");
      expect(shared.report.explanation).toContain("[REDACTED EMAIL]");
      expect(shared.report.explanation).toContain("[REDACTED PHONE]");
      expect(shared.shareLink.accessCount).toBe(1);
    });

    it("rejects access when share link has expired", async () => {
      const created = await createShareLink("rep-share-1", "owner-user-1");
      // Simulate expiration
      inMemoryShareLinks[0].expiresAt = new Date(Date.now() - 1000 * 60);

      await expect(getSharedReportByToken(created.token)).rejects.toThrow(
        /expired/i
      );
    });

    it("rejects access when share link has been revoked", async () => {
      const created = await createShareLink("rep-share-1", "owner-user-1");
      await revokeShareLink(created.id, "owner-user-1");

      await expect(getSharedReportByToken(created.token)).rejects.toThrow(
        /revoked/i
      );
    });

    it("rejects revocation attempt by a non-owner", async () => {
      const created = await createShareLink("rep-share-1", "owner-user-1");
      await expect(
        revokeShareLink(created.id, "unauthorized-user")
      ).rejects.toThrow(ForbiddenError);
    });
  });
});

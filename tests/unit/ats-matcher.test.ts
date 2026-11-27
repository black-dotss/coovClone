import { describe, it, expect } from "vitest";
import { matchRequirementsAgainstCv } from "@/lib/job-descriptions/matcher";
import { extractAndNormalizeRequirements } from "@/lib/job-descriptions/extractor";

describe("ATS Evidence Matching Engine", () => {
  const jdText = `
    Required Qualifications:
    - Experience with TypeScript and PostgreSQL.
    - Cloud deployment using AWS.
    - Python experience.
  `;

  const cvText = `
    Experienced Full-Stack Developer with 6 years building distributed systems.
    Proficient in TypeScript for modern web applications.
    Managed relational data stores using Postgres clusters in production.
    Never worked with Python or Ruby.
  `;

  it("distinguishes exact matches from alias matches and missing terms", () => {
    const requirements = extractAndNormalizeRequirements(jdText);
    const report = matchRequirementsAgainstCv(requirements, cvText);

    expect(report.totalRequirements).toBeGreaterThan(0);

    // TypeScript appears exactly in the CV
    const tsMatch = report.results.find((r) => r.term.toLowerCase() === "typescript");
    expect(tsMatch).toBeDefined();
    expect(tsMatch?.classification).toBe("matched");
    expect(tsMatch?.isAliasMatch).toBe(false);
    expect(tsMatch?.confidence).toBe(1.0);
    expect(tsMatch?.evidenceSnippet).toContain("TypeScript");

    // PostgreSQL appears as alias 'Postgres' in the CV
    const pgMatch = report.results.find((r) => r.term.toLowerCase() === "postgresql");
    expect(pgMatch).toBeDefined();
    expect(pgMatch?.classification).toBe("partial");
    expect(pgMatch?.isAliasMatch).toBe(true);
    expect(pgMatch?.confidence).toBe(0.8);
    expect(pgMatch?.matchedTerm?.toLowerCase()).toBe("postgres");
    expect(pgMatch?.evidenceSnippet?.toLowerCase()).toContain("postgres");

    // AWS does not appear in CV
    const awsMatch = report.results.find((r) => r.term.toLowerCase() === "aws");
    expect(awsMatch).toBeDefined();
    expect(awsMatch?.classification).toBe("missing");
    expect(awsMatch?.confidence).toBe(0.0);
  });

  it("calculates keyword coverage percentage while preserving ATS disclaimer", () => {
    const requirements = extractAndNormalizeRequirements(jdText);
    const report = matchRequirementsAgainstCv(requirements, cvText);

    expect(report.keywordCoveragePercentage).toBeGreaterThan(0);
    expect(report.disclaimer).toContain("strictly separate from overall role suitability");
  });
});

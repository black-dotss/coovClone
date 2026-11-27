import { describe, it, expect } from "vitest";
import { extractAndNormalizeRequirements } from "@/lib/job-descriptions/extractor";

describe("Job Description Requirements Extractor", () => {
  const sampleJd = `
    Job Title: Senior Full-Stack Engineer
    Company: TechCorp Ethiopia

    About the Role:
    We are looking for a Senior Engineer with 5+ years of hands-on experience building scalable applications.

    Responsibilities:
    - Lead backend architecture and microservices design.
    - Collaborate with product and design teams to deliver high-quality features.

    Required Qualifications:
    - 5+ years of experience with TypeScript and Node.js.
    - Strong database skills in PostgreSQL and Redis.
    - Experience with Docker and AWS.
    - Bachelor's degree in Computer Science or equivalent.

    Preferred Qualifications:
    - Experience with Next.js and GraphQL.
    - Hands-on knowledge of Kubernetes and CI/CD pipelines.
  `;

  it("extracts required and preferred skills, experience, and education", () => {
    const normalized = extractAndNormalizeRequirements(sampleJd);

    expect(normalized.minYearsExperience).toBe(5);
    expect(normalized.educationLevel).toBeDefined();
    expect(normalized.educationLevel?.toLowerCase()).toContain("bachelor");

    expect(normalized.summary.requiredCount).toBeGreaterThan(0);
    expect(normalized.summary.preferredCount).toBeGreaterThan(0);
    expect(normalized.summary.categoryCounts.skills).toBeGreaterThan(0);

    const termNames = normalized.requirements.map((r) => r.term.toLowerCase());
    expect(termNames).toContain("typescript");
    expect(termNames).toContain("node.js");
    expect(termNames).toContain("postgresql");
    expect(termNames).toContain("aws");
  });

  it("attaches aliases to extracted technical terms without replacing canonical term", () => {
    const normalized = extractAndNormalizeRequirements(sampleJd);
    const postgresReq = normalized.requirements.find(
      (r) => r.term.toLowerCase() === "postgresql"
    );

    expect(postgresReq).toBeDefined();
    expect(postgresReq?.aliases).toContain("postgres");
    expect(postgresReq?.aliases).toContain("pgsql");
  });

  it("classifies importance based on section headers", () => {
    const normalized = extractAndNormalizeRequirements(sampleJd);
    const tsReq = normalized.requirements.find((r) => r.term.toLowerCase() === "typescript");
    const nextReq = normalized.requirements.find((r) => r.term.toLowerCase() === "next.js");

    expect(tsReq?.importance).toBe("required");
    expect(nextReq?.importance).toBe("preferred");
  });
});

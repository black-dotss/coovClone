import { describe, it, expect } from "vitest";
import { AGENT_ROLES } from "@/lib/agents/types";
import { executeAgent } from "@/lib/agents/personas/executor";
import { MockLLMProvider } from "@/lib/ai/providers/mock";

const FIXTURE_CV = `
Alex Mercer
Senior Software Engineer | alex.mercer@example.com | San Francisco, CA

EXPERIENCE
Acme Cloud Systems — Senior Backend Engineer
March 2021 – Present
- Architected and built distributed microservices using TypeScript, Node.js, and PostgreSQL.
- Reduced API p99 latency by 35% across core billing endpoints serving 250,000 monthly users.
- Led migration of legacy monolithic data pipeline to asynchronous event queues using Redis.

Beta Logistics — Software Engineer
June 2018 – February 2021
- Developed real-time fleet tracking dashboard with React and WebSockets.
- Maintained Docker containers and orchestrated deployments on AWS ECS.

EDUCATION
Bachelor of Science in Computer Science, University of California, Berkeley (2018)
SKILLS
Languages & Frameworks: TypeScript, JavaScript, Node.js, React, Python, SQL
Databases & Cloud: PostgreSQL, Redis, Docker, AWS (S3, ECS, RDS)
`;

const FIXTURE_JD = `
Senior Backend Engineer — Stripe
We are seeking an experienced Senior Backend Engineer to design and scale our payments platform.

Required Qualifications:
- 4+ years of professional software engineering experience.
- Strong proficiency in TypeScript, Node.js, and relational databases like PostgreSQL.
- Experience building scalable distributed systems and asynchronous processing.
- Proven track record of improving latency, reliability, and system performance.

Preferred Qualifications:
- Experience with Kafka, Kubernetes, and Golang.
- Familiarity with fintech regulations and compliance.
`;

describe("Six Recruitment Agent Personas", () => {
  const provider = new MockLLMProvider();

  it("executes all six agents and confirms each produces schema-valid, evidence-grounded assessments", async () => {
    for (const role of AGENT_ROLES) {
      const res = await executeAgent(
        {
          agentRole: role,
          cvText: FIXTURE_CV,
          jdText: FIXTURE_JD,
          tone: "strict",
        },
        provider
      );

      expect(res.output.agentRole).toBe(role);
      expect(res.output.scoreContribution).toBeGreaterThanOrEqual(0);
      expect(res.output.scoreContribution).toBeLessThanOrEqual(100);
      expect(res.output.findings.length).toBeGreaterThan(0);

      // Verify evidence grounding
      for (const finding of res.output.findings) {
        expect(finding.claim.length).toBeGreaterThan(5);
        expect(finding.evidenceSnippet.length).toBeGreaterThan(2);
        expect(finding.sourceReference.length).toBeGreaterThan(2);
        expect(["low", "medium", "high", "critical"]).toContain(finding.severity);
      }
    }
  });

  it("HR Recruiter verifies career chronology and identifiable timeline dates", async () => {
    const res = await executeAgent(
      {
        agentRole: "hr_recruiter",
        cvText: FIXTURE_CV,
        jdText: FIXTURE_JD,
        tone: "strict",
      },
      provider
    );

    expect(res.output.scoreContribution).toBeGreaterThanOrEqual(70);
    const dateFinding = res.output.findings.find((f) => f.sourceReference.includes("Chronology"));
    expect(dateFinding).toBeDefined();
    expect(dateFinding?.evidenceSnippet).toMatch(/2021|Present|2018/);
  });

  it("Technical Interviewer validates matching skills and cites evidence from project bullets", async () => {
    const res = await executeAgent(
      {
        agentRole: "technical_interviewer",
        cvText: FIXTURE_CV,
        jdText: FIXTURE_JD,
        tone: "strict",
      },
      provider
    );

    const verifiedFinding = res.output.findings.find((f) => f.severity === "low");
    expect(verifiedFinding).toBeDefined();
    expect(verifiedFinding?.claim).toContain("TypeScript");
  });

  it("ATS Scanner reports exact, alias, and missing keywords with parser coverage", async () => {
    const res = await executeAgent(
      {
        agentRole: "ats_scanner",
        cvText: FIXTURE_CV,
        jdText: FIXTURE_JD,
        tone: "strict",
      },
      provider
    );

    expect(res.output.scoreContribution).toBeGreaterThanOrEqual(50);
    expect(res.output.position).toContain("ATS keyword analysis completed");
  });

  it("Hiring Manager evaluates commercial impact and quantifiable metrics", async () => {
    const res = await executeAgent(
      {
        agentRole: "hiring_manager",
        cvText: FIXTURE_CV,
        jdText: FIXTURE_JD,
        tone: "strict",
      },
      provider
    );

    expect(res.output.scoreContribution).toBeGreaterThanOrEqual(75);
    const metricFinding = res.output.findings.find((f) => f.claim.includes("quantifiable"));
    expect(metricFinding).toBeDefined();
    expect(metricFinding?.evidenceSnippet).toContain("35%");
  });

  it("Red Flag Analyst enforces 'A flag is not proof of a problem' and passes clean CV", async () => {
    const res = await executeAgent(
      {
        agentRole: "red_flag_analyst",
        cvText: FIXTURE_CV,
        jdText: FIXTURE_JD,
        tone: "strict",
      },
      provider
    );

    expect(res.output.position).toContain("A flag is not proof of a problem");
    expect(res.output.findings[0].claim).toContain("A flag is not proof of a problem");
  });
});

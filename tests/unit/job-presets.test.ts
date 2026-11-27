import { describe, it, expect } from "vitest";
import {
  FAMOUS_ROLE_PRESETS,
  isFamousPresetJd,
  FAMOUS_COMPANY_KEYWORDS,
} from "@/lib/job-descriptions/presets";

describe("Famous Role Presets and Filtering", () => {
  it("exports all canonical benchmark presets with required fields", () => {
    expect(FAMOUS_ROLE_PRESETS.length).toBeGreaterThanOrEqual(6);
    const ids = FAMOUS_ROLE_PRESETS.map((p) => p.id);
    expect(ids).toContain("google");
    expect(ids).toContain("amazon");
    expect(ids).toContain("meta");
    expect(ids).toContain("netflix");
    expect(ids).toContain("apple");
    expect(ids).toContain("microsoft");

    for (const preset of FAMOUS_ROLE_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.company.length).toBeGreaterThan(0);
      expect(preset.role.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(50);
    }

    for (const keyword of FAMOUS_COMPANY_KEYWORDS) {
      expect(keyword.length).toBeGreaterThan(0);
    }
  });

  it("identifies famous company benchmark roles by company name or aliases", () => {
    expect(isFamousPresetJd({ company: "Google" })).toBe(true);
    expect(isFamousPresetJd({ company: "google inc" })).toBe(true);
    expect(isFamousPresetJd({ company: "Amazon AWS" })).toBe(true);
    expect(isFamousPresetJd({ company: "AWS" })).toBe(true);
    expect(isFamousPresetJd({ company: "Meta" })).toBe(true);
    expect(isFamousPresetJd({ company: "Meta Platforms" })).toBe(true);
    expect(isFamousPresetJd({ company: "Facebook" })).toBe(true);
    expect(isFamousPresetJd({ company: "Netflix" })).toBe(true);
    expect(isFamousPresetJd({ company: "Apple" })).toBe(true);
    expect(isFamousPresetJd({ company: "Microsoft" })).toBe(true);
    expect(isFamousPresetJd({ company: "Microsoft Azure" })).toBe(true);
  });

  it("identifies presets by role title matching canonical preset roles", () => {
    expect(
      isFamousPresetJd({
        company: "Custom Company",
        roleTitle: "Senior Software Engineer (L5)",
      })
    ).toBe(true);

    expect(
      isFamousPresetJd({
        company: "Unknown",
        title: "Senior Platform Engineer (E5)",
      })
    ).toBe(true);

    expect(
      isFamousPresetJd({
        company: "Unknown",
        title: "Software Development Engineer II",
      })
    ).toBe(true);
  });

  it("identifies presets by description snippet matches", () => {
    expect(
      isFamousPresetJd({
        company: "Tech Corp",
        rawText:
          "Distributed systems architecture, high-throughput microservices handling millions of QPS, fault tolerance, consistency models, and collaborative technical leadership.",
      })
    ).toBe(true);
  });

  it("does not filter genuine custom user jobs", () => {
    expect(
      isFamousPresetJd({
        company: "Stripe",
        roleTitle: "Staff Infrastructure Engineer",
        rawText: "Lead payments reliability and ledger consensus engineering.",
      })
    ).toBe(false);

    expect(
      isFamousPresetJd({
        company: "Airbnb",
        title: "Senior Fullstack Engineer",
        rawText: "Design and scale guest booking flow and checkout components.",
      })
    ).toBe(false);

    expect(
      isFamousPresetJd({
        company: "Datadog",
        roleTitle: "Distributed Tracing Architect",
        rawText: "Build next-generation telemetry pipelines and agent ingestion.",
      })
    ).toBe(false);

    expect(
      isFamousPresetJd({
        company: "Local Startup",
        title: "Lead Developer",
        rawText: "Build MVP using Next.js and Postgres database.",
      })
    ).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import "@/lib/documents/polyfills";
import { generateReportPdf } from "@/lib/reports/pdf";
import { StructuredEvaluationReport } from "@/lib/reports/types";
import { PDFParse } from "pdf-parse";

const mockReport: StructuredEvaluationReport = {
  id: "rep-pdf-test-1",
  evaluationId: "eval-pdf-test-1",
  overallScore: 82,
  verdict: "Strong fit",
  confidence: 0.9,
  explanation: "Candidate displays strong technical backend engineering skills and excellent metrics.",
  dimensions: {
    roleFit: 85,
    skillsAndEvidence: 88,
    atsAlignment: 80,
    impactAndClarity: 78,
    professionalPresentation: 82,
  },
  strengths: [
    "Extensive PostgreSQL and distributed systems experience",
    "Quantified latency improvements of 40%",
  ],
  weaknesses: [
    "Limited mention of automated end-to-end integration testing",
  ],
  prioritizedFixes: [
    {
      fix: "Add metrics for Kubernetes deployment pipeline reliability",
      expectedBenefit: "Increases hiring manager confidence in DevOps capability",
      effort: "medium",
    },
  ],
  redFlags: [],
  likelyInterviewQuestions: [
    {
      question: "How did you optimize PostgreSQL query performance under peak load?",
      tiedToClaim: "Reduced query times by 40%",
      rationale: "Tests practical database performance tuning experience",
    },
  ],
  atsSummary: {
    keywordCoverage: 84,
    matched: ["PostgreSQL", "Node.js", "Docker"],
    partial: ["AWS"],
    missing: ["Kubernetes"],
    disclaimer: "ATS alignment reflects keyword coverage, not overall suitability.",
  },
  uncertaintyNotes: [],
  disclaimer: "CookMyCv recruitment simulation assessment, not an official employer hiring decision.",
  createdAt: new Date("2026-11-16T12:00:00Z"),
  updatedAt: new Date("2026-11-16T12:00:00Z"),
};

describe("PDF Report Generation", () => {
  it("generates a downloadable PDF report as a valid binary buffer", async () => {
    const pdfBuffer = await generateReportPdf(mockReport, {
      candidateName: "Abebe Kebede",
      targetRole: "Senior Backend Engineer",
      targetCompany: "Ethio Telecom",
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    // Verify standard PDF magic header bytes (%PDF-)
    const header = pdfBuffer.subarray(0, 5).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("produces consistent PDF binary outputs with key report sections", async () => {
    const pdfBuffer = await generateReportPdf(mockReport);

    const parser = new PDFParse({ data: pdfBuffer });
    const parsed = await parser.getText();
    const extractedText = parsed.text;

    expect(extractedText).toContain("CookMyCV Evaluation Report");
    expect(extractedText).toContain("82 / 100");
    expect(extractedText).toContain("Strong fit");
    expect(extractedText).toContain("Candidate displays strong technical backend engineering skills");
    expect(extractedText).toContain("Role & Experience Fit: 85/100");
    expect(extractedText).toContain("Extensive PostgreSQL and distributed systems experience");
    expect(extractedText).toContain("Add metrics for Kubernetes deployment pipeline reliability");
    expect(extractedText).toContain("CookMyCv recruitment simulation assessment");
  });

  it("redacts personal contact details in PDF when redactPersonal option is enabled", async () => {
    const reportWithContacts: StructuredEvaluationReport = {
      ...mockReport,
      explanation: "Contact candidate at test.user@gmail.com or call 0911223344 for portfolio at https://github.com/testuser",
    };

    const pdfBuffer = await generateReportPdf(reportWithContacts, {
      redactPersonal: true,
    });

    const parser = new PDFParse({ data: pdfBuffer });
    const parsed = await parser.getText();
    const extractedText = parsed.text;

    expect(extractedText).not.toContain("test.user@gmail.com");
    expect(extractedText).not.toContain("0911223344");
    expect(extractedText).not.toContain("https://github.com/testuser");
    expect(extractedText).toContain("[REDACTED EMAIL]");
    expect(extractedText).toContain("[REDACTED PHONE]");
    expect(extractedText).toContain("[REDACTED URL]");
  });
});

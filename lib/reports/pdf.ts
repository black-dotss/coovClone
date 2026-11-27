import PDFDocument from "pdfkit";
import { StructuredEvaluationReport } from "./types";
import { redactStructuredReport } from "./redaction";

export interface GeneratePdfOptions {
  candidateName?: string;
  targetRole?: string;
  targetCompany?: string;
  redactPersonal?: boolean;
}

/**
 * Generates a structured, downloadable PDF report from evaluation results.
 */
export async function generateReportPdf(
  rawReport: StructuredEvaluationReport,
  options: GeneratePdfOptions = {}
): Promise<Buffer> {
  const report = options.redactPersonal ? redactStructuredReport(rawReport) : rawReport;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: "A4",
        info: {
          Title: `CookMyCV Evaluation Report - ${report.id}`,
          Author: "CookMyCV Recruitment Simulation",
          Subject: "CV Evaluation Report",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: Error) => reject(err));

      // Brand Header
      doc
        .fontSize(22)
        .font("Helvetica-Bold")
        .fillColor("#111827")
        .text("CookMyCV Evaluation Report", { align: "left" });

      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor("#6B7280")
        .text(`Generated on ${new Date(report.createdAt).toUTCString()} | Report ID: ${report.id.slice(0, 8)}`, {
          align: "left",
        });

      if (options.targetRole || options.targetCompany) {
        const targetDesc = [options.targetRole, options.targetCompany].filter(Boolean).join(" at ");
        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .fillColor("#374151")
          .text(`Target Position: ${targetDesc}`, { align: "left" });
      }

      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#E5E7EB").stroke();
      doc.moveDown(1);

      // Verdict & Overall Score Banner
      const score = report.overallScore ?? 0;
      let scoreColor = "#EF4444"; // red
      if (score >= 80) scoreColor = "#10B981"; // green
      else if (score >= 60) scoreColor = "#F59E0B"; // amber

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .fillColor("#111827")
        .text("Executive Summary & Overall Verdict");

      doc.moveDown(0.5);

      doc
        .fontSize(26)
        .font("Helvetica-Bold")
        .fillColor(scoreColor)
        .text(`${score} / 100`, { continued: true })
        .fontSize(16)
        .fillColor("#374151")
        .text(`  —  ${report.verdict}`);

      doc.moveDown(0.5);

      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor("#374151")
        .text(report.explanation, { lineGap: 3 });

      doc.moveDown(1);

      // Dimensions Breakdown
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#111827")
        .text("Evaluation Dimensions");

      doc.moveDown(0.5);

      const dims = report.dimensions ?? {
        roleFit: 0,
        skillsAndEvidence: 0,
        atsAlignment: 0,
        impactAndClarity: 0,
        professionalPresentation: 0,
      };

      const dimList = [
        { label: "Role & Experience Fit", val: dims.roleFit },
        { label: "Technical Skills & Evidence", val: dims.skillsAndEvidence },
        { label: "ATS Keyword Alignment", val: dims.atsAlignment },
        { label: "Business Impact & Metrics", val: dims.impactAndClarity },
        { label: "Structure & Presentation", val: dims.professionalPresentation },
      ];

      for (const d of dimList) {
        doc
          .fontSize(10)
          .font("Helvetica")
          .fillColor("#4B5563")
          .text(`• ${d.label}: `, { continued: true })
          .font("Helvetica-Bold")
          .fillColor("#111827")
          .text(`${d.val}/100`);
      }

      doc.moveDown(1);

      // Strengths & Weaknesses (2 Columns or sequential)
      if (report.strengths && report.strengths.length > 0) {
        doc
          .fontSize(12)
          .font("Helvetica-Bold")
          .fillColor("#059669")
          .text("Key Strengths & Evidence");
        doc.moveDown(0.3);

        for (const str of report.strengths.slice(0, 5)) {
          doc
            .fontSize(9.5)
            .font("Helvetica")
            .fillColor("#1F2937")
            .text(`+  ${str}`, { lineGap: 2 });
        }
        doc.moveDown(0.8);
      }

      if (report.weaknesses && report.weaknesses.length > 0) {
        doc
          .fontSize(12)
          .font("Helvetica-Bold")
          .fillColor("#DC2626")
          .text("Critical Weaknesses & Vulnerabilities");
        doc.moveDown(0.3);

        for (const w of report.weaknesses.slice(0, 5)) {
          doc
            .fontSize(9.5)
            .font("Helvetica")
            .fillColor("#1F2937")
            .text(`-  ${w}`, { lineGap: 2 });
        }
        doc.moveDown(0.8);
      }

      // Prioritized Action Fixes
      if (report.prioritizedFixes && report.prioritizedFixes.length > 0) {
        doc
          .fontSize(12)
          .font("Helvetica-Bold")
          .fillColor("#111827")
          .text("Prioritized Actionable Fixes");
        doc.moveDown(0.3);

        for (const fix of report.prioritizedFixes.slice(0, 4)) {
          doc
            .fontSize(10)
            .font("Helvetica-Bold")
            .fillColor("#1F2937")
            .text(`[${(fix.effort || "med").toUpperCase()}] ${fix.fix}`);

          doc
            .fontSize(9)
            .font("Helvetica")
            .fillColor("#4B5563")
            .text(`Expected Benefit: ${fix.expectedBenefit}`, { lineGap: 3 });
          doc.moveDown(0.3);
        }
        doc.moveDown(0.5);
      }

      // Likely Interview Questions
      if (report.likelyInterviewQuestions && report.likelyInterviewQuestions.length > 0) {
        doc
          .fontSize(12)
          .font("Helvetica-Bold")
          .fillColor("#111827")
          .text("Likely Interview Questions to Prepare For");
        doc.moveDown(0.3);

        for (const q of report.likelyInterviewQuestions.slice(0, 3)) {
          doc
            .fontSize(9.5)
            .font("Helvetica-Bold")
            .fillColor("#1F2937")
            .text(`Q: ${q.question}`);

          if (q.tiedToClaim) {
            doc
              .fontSize(8.5)
              .font("Helvetica-Oblique")
              .fillColor("#6B7280")
              .text(`Tied to: ${q.tiedToClaim}`);
          }
          if (q.rationale) {
            doc
              .fontSize(8.5)
              .font("Helvetica")
              .fillColor("#4B5563")
              .text(`Rationale: ${q.rationale}`);
          }
          doc.moveDown(0.3);
        }
      }

      // Legal & Simulation Disclaimer
      doc.moveDown(1.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#E5E7EB").stroke();
      doc.moveDown(0.5);

      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#9CA3AF")
        .text(
          report.disclaimer ||
            "CookMyCV recruitment simulation assessment, not an official employer hiring decision.",
          { align: "center" }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

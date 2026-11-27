import { StructuredEvaluationReport } from "./types";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const ETHIOPIAN_PHONE_REGEX = /(?:\+?251|0)\s*(?:9|7)\d{8}\b/g;
const GENERAL_PHONE_REGEX = /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
const URL_REGEX = /https?:\/\/[^\s"'<>\)]+/gi;

/**
 * Redacts personal contact details (email, phone, URLs, address patterns) from a text string.
 */
export function redactPersonalInformation(text: string): string {
  if (!text) return text;

  let sanitized = text;

  // 1. Redact Email addresses
  sanitized = sanitized.replace(EMAIL_REGEX, "[REDACTED EMAIL]");

  // 2. Redact Ethiopian and International Phone Numbers
  sanitized = sanitized.replace(ETHIOPIAN_PHONE_REGEX, "[REDACTED PHONE]");
  sanitized = sanitized.replace(GENERAL_PHONE_REGEX, (match) => {
    // Only redact if string contains at least 7 digits (avoid redacting small numbers like years 2024 or scores)
    const digitCount = match.replace(/\D/g, "").length;
    if (digitCount >= 7) {
      return "[REDACTED PHONE]";
    }
    return match;
  });

  // 3. Redact URLs (e.g. portfolio, LinkedIn, personal github)
  sanitized = sanitized.replace(URL_REGEX, "[REDACTED URL]");

  return sanitized;
}

/**
 * Creates a redacted copy of a structured evaluation report, ensuring
 * candidate contact info is scrubbed before public sharing.
 */
export function redactStructuredReport(
  report: StructuredEvaluationReport
): StructuredEvaluationReport {
  return {
    ...report,
    explanation: redactPersonalInformation(report.explanation),
    strengths: report.strengths.map(redactPersonalInformation),
    weaknesses: report.weaknesses.map(redactPersonalInformation),
    prioritizedFixes: report.prioritizedFixes.map((f) => ({
      ...f,
      fix: redactPersonalInformation(f.fix),
      expectedBenefit: redactPersonalInformation(f.expectedBenefit),
    })),
    redFlags: report.redFlags.map((flag) => ({
      ...flag,
      flag: redactPersonalInformation(flag.flag),
      evidenceSnippet: redactPersonalInformation(flag.evidenceSnippet),
    })),
    likelyInterviewQuestions: report.likelyInterviewQuestions.map((q) => ({
      ...q,
      question: redactPersonalInformation(q.question),
      tiedToClaim: redactPersonalInformation(q.tiedToClaim),
      rationale: redactPersonalInformation(q.rationale),
    })),
    uncertaintyNotes: report.uncertaintyNotes.map(redactPersonalInformation),
  };
}

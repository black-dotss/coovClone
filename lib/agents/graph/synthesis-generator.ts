import {
  AgentOutput,
  AgentRole,
  DebateTurn,
  InterviewQuestionItem,
  PrioritizedFix,
  RedFlagNote,
  SynthesisReport,
} from "../types";
import { EvaluationDimensions, EvaluationTone } from "@/lib/evaluations/types";
import { calculateWeightedScore, mapScoreToVerdict } from "@/lib/evaluations";
import { matchJobDescriptionText } from "@/lib/job-descriptions/matcher";

export function generateSynthesisReport(
  agentOutputs: Record<AgentRole, AgentOutput>,
  debateTurns: DebateTurn[],
  cvText: string,
  jdText: string,
  _tone: EvaluationTone
): SynthesisReport {
  const hr = agentOutputs.hr_recruiter;
  const tech = agentOutputs.technical_interviewer;
  const ats = agentOutputs.ats_scanner;
  const hm = agentOutputs.hiring_manager;
  const strat = agentOutputs.career_strategist;
  const redFlag = agentOutputs.red_flag_analyst;

  // 1. Calculate Dimension Scores (0 - 100)
  const roleFit = Math.round(hm.scoreContribution * 0.6 + hr.scoreContribution * 0.4);
  const skillsAndEvidence = Math.round(tech.scoreContribution);
  const atsAlignment = Math.round(ats.scoreContribution);
  const impactAndClarity = Math.round(hm.scoreContribution);
  const professionalPresentation = Math.round(hr.scoreContribution * 0.5 + strat.scoreContribution * 0.5);

  const dimensions: EvaluationDimensions = {
    roleFit: Math.min(100, Math.max(0, roleFit)),
    skillsAndEvidence: Math.min(100, Math.max(0, skillsAndEvidence)),
    atsAlignment: Math.min(100, Math.max(0, atsAlignment)),
    impactAndClarity: Math.min(100, Math.max(0, impactAndClarity)),
    professionalPresentation: Math.min(100, Math.max(0, professionalPresentation)),
  };

  // 2. Weighted Overall Score & Verdict
  const overallScore = Math.round(calculateWeightedScore(dimensions));
  const verdict = mapScoreToVerdict(overallScore);

  // Confidence calculation based on evidence consistency
  const allFindings = Object.values(agentOutputs).flatMap((a) => a.findings);
  const uncertainCount = allFindings.filter((f) => f.isUncertain).length;
  const confidence = Math.max(0.65, Math.min(0.98, Math.round((1 - (uncertainCount / (allFindings.length || 1)) * 0.25) * 100) / 100));

  // 3. Strengths & Weaknesses
  const strengths = [
    ...tech.findings.filter((f) => f.severity === "low").map((f) => f.claim),
    ...hm.findings.filter((f) => f.severity === "low").map((f) => f.claim),
    ...strat.findings.map((f) => f.claim),
  ].slice(0, 4);

  const weaknesses = [
    ...tech.findings.filter((f) => f.severity !== "low").map((f) => f.claim),
    ...hm.findings.filter((f) => f.severity !== "low").map((f) => f.claim),
    ...ats.findings.filter((f) => f.severity !== "low").map((f) => f.claim),
    ...hr.findings.filter((f) => f.severity !== "low").map((f) => f.claim),
  ].slice(0, 4);

  // 4. Prioritized Fixes (3 to 5 items)
  const prioritizedFixes: PrioritizedFix[] = [];

  if (ats.scoreContribution < 75) {
    prioritizedFixes.push({
      fix: "Incorporate high-priority missing technical keywords and domain terminology from the job description directly into relevant project descriptions.",
      expectedBenefit: "Increases initial ATS parser screening pass rate by an estimated 15-25%.",
      effort: "low",
    });
  }

  if (hm.scoreContribution < 75) {
    prioritizedFixes.push({
      fix: "Rewrite duty-focused bullet points to highlight measurable business outcomes (e.g. latency reduced by X%, revenue lifted by $Y, or team scale).",
      expectedBenefit: "Demonstrates tangible commercial ownership and ROI to hiring managers.",
      effort: "medium",
    });
  }

  if (hr.scoreContribution < 75) {
    prioritizedFixes.push({
      fix: "Clarify employment chronology with unambiguous month-and-year date ranges to eliminate perceived gaps.",
      expectedBenefit: "Reduces screening skepticism regarding employment continuity.",
      effort: "low",
    });
  }

  prioritizedFixes.push({
    fix: "Expand on architectural decision-making and tool trade-offs within the most recent engineering project.",
    expectedBenefit: "Validates technical seniority and hands-on depth during interviewer review.",
    effort: "medium",
  });

  if (prioritizedFixes.length < 3) {
    prioritizedFixes.push({
      fix: "Elevate executive summary to spotlight distinct competitive differentiators and leadership achievements.",
      expectedBenefit: "Immediately captures recruiter and hiring manager attention during initial scan.",
      effort: "low",
    });
  }

  if (prioritizedFixes.length < 3) {
    prioritizedFixes.push({
      fix: "Strengthen action verbs across all bullet points to emphasize active technical ownership over passive task support.",
      expectedBenefit: "Sharpens professional presentation and leadership signals across the entire profile.",
      effort: "low",
    });
  }

  // Ensure 3 to 5 fixes
  const finalFixes = prioritizedFixes.slice(0, 5);

  // 5. Red Flags
  const redFlags: RedFlagNote[] = redFlag.findings.map((f) => ({
    flag: f.claim,
    evidenceSnippet: f.evidenceSnippet,
    isProofOfProblem: false as const,
  }));

  // 6. Likely Interview Questions (Rich multi-agent questions grounded in candidate CV findings)
  const likelyInterviewQuestions: InterviewQuestionItem[] = [
    {
      question: tech.findings[0]?.claim
        ? `Regarding your experience with "${tech.findings[0].claim}", can you walk through the system architecture you built, key technical constraints, and trade-offs you handled?`
        : "Can you walk through the system architecture of the most technically challenging project cited in your resume and discuss key trade-offs?",
      tiedToClaim: tech.findings[0]?.claim ?? "Technical competency",
      rationale: "Tests actual engineering depth beyond high-level buzzwords and tool lists.",
    },
    {
      question: hm.findings[0]?.claim
        ? `In your CV you state "${hm.findings[0].claim}". How specifically did you measure commercial and operational success, and what metrics moved?`
        : "In your previous role, how did you measure the success and commercial impact of your deliverables?",
      tiedToClaim: hm.findings[0]?.claim ?? "Quantified business impact",
      rationale: "Validates whether the candidate drove outcomes or merely executed isolated tasks.",
    },
    {
      question: ats.findings[0]?.claim
        ? `Your resume references "${ats.findings[0].claim}". How did you adapt your tooling to bridge requirements not covered in your core stack?`
        : "How have you adapted to new tools and tech stacks not explicitly covered in your primary background?",
      tiedToClaim: ats.findings[0]?.claim ?? "ATS alignment",
      rationale: "Probes candidate agility in bridging missing tech requirements.",
    },
    {
      question: redFlags[0]?.flag
        ? `In your background you highlight "${redFlags[0].flag}". What were the exact implementation steps, and how did you verify correctness in production?`
        : "Describe a project where you diagnosed a complex production degradation or architectural failure and how you resolved it.",
      tiedToClaim: redFlags[0]?.flag ?? "Production reliability and claim verification",
      rationale: "Probes claim validity and hands-on depth on complex project milestones.",
    },
    {
      question: finalFixes[0]?.fix
        ? `One area identified in your review is: "${finalFixes[0].fix}". How would you demonstrate ownership and proactive problem-solving around this in your daily engineering?`
        : "Walk us through how you manage technical debt and test coverage while balancing aggressive product delivery timelines.",
      tiedToClaim: finalFixes[0]?.fix ?? "Execution rigor & proactive remediation",
      rationale: "Assesses self-awareness and candidate ability to articulate solutions to weak points.",
    },
    {
      question: "Describe a high-stakes technical disagreement you had with a teammate or senior stakeholder. How did you structure your argument with objective evidence and reach a constructive consensus?",
      tiedToClaim: hr.findings[0]?.claim ?? "Engineering collaboration & stakeholder management",
      rationale: "Assesses communication clarity, team alignment, and emotional intelligence under pressure.",
    },
  ];

  // 7. ATS Summary using matcher
  const atsMatch = matchJobDescriptionText(jdText, cvText);
  const atsSummary = {
    keywordCoverage: atsMatch.keywordCoveragePercentage,
    matched: atsMatch.matchedTerms,
    partial: atsMatch.partialTerms,
    missing: atsMatch.missingTerms,
    disclaimer: atsMatch.disclaimer,
  };

  // 8. Uncertainty Notes
  const uncertaintyNotes = allFindings
    .filter((f) => f.isUncertain && f.uncertaintyReason)
    .map((f) => `${f.claim}: ${f.uncertaintyReason}`);

  // Explanation
  const explanation =
    `CookMyCv evaluation panel completed a multi-agent review across 6 recruitment dimensions. ` +
    `Candidate achieved an overall weighted score of ${overallScore}/100 resulting in a '${verdict}' assessment. ` +
    `Key strengths include ${strengths.slice(0, 2).join("; ") || "baseline professional presentation"}, while priority focus should center on ${finalFixes[0]?.fix || "clarifying metrics"}.`;

  return {
    overallScore,
    verdict,
    confidence,
    dimensions,
    explanation,
    strengths: strengths.length > 0 ? strengths : ["Demonstrated professional work history"],
    weaknesses: weaknesses.length > 0 ? weaknesses : ["Scope for greater metric quantification"],
    prioritizedFixes: finalFixes,
    redFlags,
    likelyInterviewQuestions,
    atsSummary,
    uncertaintyNotes,
  };
}

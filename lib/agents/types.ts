import { EvaluationTone, Verdict } from "@/lib/evaluations/types";
import { NormalizedRequirements } from "@/lib/job-descriptions/types";

export const AGENT_ROLES = [
  "hr_recruiter",
  "technical_interviewer",
  "ats_scanner",
  "hiring_manager",
  "career_strategist",
  "red_flag_analyst",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export interface AgentFinding {
  claim: string;
  evidenceSnippet: string;
  sourceReference: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  isUncertain: boolean;
  uncertaintyReason?: string;
}

export interface AgentOutput {
  agentRole: AgentRole;
  displayName: string;
  position: string;
  scoreContribution: number;
  findings: AgentFinding[];
  missingInformation: string[];
  questionsForDebate: string[];
  tone: EvaluationTone;
  voiceCommentary: string;
}

export interface AgentInput {
  agentRole: AgentRole;
  cvText: string;
  jdText: string;
  tone: EvaluationTone;
  normalizedRequirements?: NormalizedRequirements;
}

export interface DebateTurn {
  sequence: number;
  agentRole: AgentRole;
  replyToRole?: AgentRole;
  content: string;
  evidenceReferences: string[];
}

export interface PrioritizedFix {
  fix: string;
  expectedBenefit: string;
  effort: "low" | "medium" | "high";
}

export interface RedFlagNote {
  flag: string;
  evidenceSnippet: string;
  isProofOfProblem: false;
}

export interface InterviewQuestionItem {
  question: string;
  tiedToClaim: string;
  rationale: string;
}

export interface SynthesisReport {
  overallScore: number;
  verdict: Verdict;
  confidence: number;
  dimensions: {
    roleFit: number;
    skillsAndEvidence: number;
    atsAlignment: number;
    impactAndClarity: number;
    professionalPresentation: number;
  };
  explanation: string;
  strengths: string[];
  weaknesses: string[];
  prioritizedFixes: PrioritizedFix[];
  redFlags: RedFlagNote[];
  likelyInterviewQuestions: InterviewQuestionItem[];
  atsSummary: {
    keywordCoverage: number;
    matched: string[];
    partial: string[];
    missing: string[];
    disclaimer: string;
  };
  uncertaintyNotes: string[];
}

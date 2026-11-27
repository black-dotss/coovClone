import type { Verdict, EvaluationDimensions } from "../evaluations/types";
import type { InterviewQuestionItem, PrioritizedFix, RedFlagNote } from "../agents/types";

export type { PrioritizedFix, RedFlagNote, InterviewQuestionItem };

export interface AtsKeywordSummary {
  keywordCoverage: number;
  matched: string[];
  partial: string[];
  missing: string[];
  disclaimer: string;
}

export interface StructuredEvaluationReport {
  id: string;
  evaluationId: string;
  overallScore: number;
  verdict: Verdict;
  confidence: number;
  explanation: string;
  targetRole?: string;
  targetCompany?: string;
  dimensions: EvaluationDimensions;
  strengths: string[];
  weaknesses: string[];
  prioritizedFixes: PrioritizedFix[];
  redFlags: RedFlagNote[];
  likelyInterviewQuestions: InterviewQuestionItem[];
  atsSummary: AtsKeywordSummary;
  uncertaintyNotes: string[];
  disclaimer: string;
  pdfStorageKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Backward-compatible alias for existing imports
export type EvaluationReport = StructuredEvaluationReport;

export interface BulletRewriteItem {
  id?: string;
  originalText: string;
  suggestedText: string;
  explanation: string;
  isAccepted?: boolean;
}

export interface RewriteSuggestionRecord {
  id: string;
  evaluationId: string;
  originalText: string;
  suggestedText: string;
  explanation: string;
  isAccepted: boolean;
  createdAt: Date;
}

export interface DefenseSubmissionInput {
  claimOrFlag: string;
  defenseText: string;
  supportingEvidence?: string;
}

export interface DefenseRevision {
  revisionNumber: number;
  submittedAt: string;
  claimOrFlag: string;
  defenseText: string;
  supportingEvidence?: string;
  scoreDelta: number;
  previousScore: number;
  newScore: number;
  previousVerdict: Verdict;
  newVerdict: Verdict;
  reassessmentRationale: string;
  revisedFindings: string[];
  committeeDialogue?: Array<{
    persona: string;
    role: string;
    comment: string;
  }>;
}

export interface MultiJdComparisonInput {
  cvVersionId: string;
  jobDescriptionIds: string[];
}

export interface RoleComparisonResult {
  jobDescriptionId: string;
  title: string;
  company: string;
  overallScore: number;
  verdict: Verdict;
  rank: number;
  dimensions: EvaluationDimensions;
  atsKeywordCoverage: number;
  keyStrengths: string[];
  criticalGaps: string[];
  interviewProbability?: number;
}

export interface MultiJdComparisonResult {
  cvVersionId: string;
  roles: RoleComparisonResult[];
  recommendedRole: {
    jobDescriptionId: string;
    title: string;
    company: string;
    reason: string;
  };
  comparisonSummary: string;
  comparedAt: string;
}

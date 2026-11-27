import { AgentRole } from "@/lib/agents/types";

export type EvaluationTone = "friendly" | "strict" | "brutal_roast";
export type EvaluationStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type Verdict = "Strong fit" | "Potential fit" | "Significant gaps" | "Weak fit";

export interface EvaluationDimensions {
  roleFit: number;          // 25%
  skillsAndEvidence: number;// 25%
  atsAlignment: number;     // 20%
  impactAndClarity: number; // 15%
  professionalPresentation: number; // 15%
}

export interface EvaluationRecord {
  id: string;
  ownerUserId: string;
  cvVersionId: string;
  jobDescriptionId: string;
  tone: EvaluationTone;
  status: EvaluationStatus;
  overallScore?: number | null;
  verdict?: Verdict | null;
  workflowState?: Record<string, unknown> | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompletedAgentSummary {
  role: AgentRole;
  displayName: string;
  scoreContribution: number;
  durationMs?: number;
  completedAt: Date;
  voiceCommentary?: string;
  position?: string;
  findings?: Array<{ claim: string; severity: string; evidenceSnippet?: string }>;
}

export interface EvaluationProgress {
  evaluationId: string;
  status: EvaluationStatus;
  progressPercentage: number;
  progressPercent?: number;
  currentPhase?: string;
  completedAgents: CompletedAgentSummary[];
  agentStatuses?: Record<string, string>;
  debateTurnsCount: number;
  debateMessages?: Array<{
    id?: string;
    sequence: number;
    agentRole: AgentRole;
    content: string;
    evidenceReferences?: string[];
  }>;
  isTerminal: boolean;
  overallScore?: number | null;
  verdict?: Verdict | null;
  errorMessage?: string | null;
  error?: string | null;
  updatedAt: Date;
}

export const VALID_STATUS_TRANSITIONS: Record<EvaluationStatus, readonly EvaluationStatus[]> = {
  queued: ["processing", "cancelled"],
  processing: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isValidStatusTransition(from: EvaluationStatus, to: EvaluationStatus): boolean {
  return VALID_STATUS_TRANSITIONS[from].includes(to);
}

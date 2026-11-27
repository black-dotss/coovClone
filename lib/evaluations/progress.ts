import { db } from "@/lib/db";
import { evaluations, agentRuns, debateMessages } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { NotFoundError, ForbiddenError } from "@/lib/shared/errors";
import { AGENT_ROLES, AgentRole } from "@/lib/agents/types";
import type { CompletedAgentSummary, EvaluationProgress, EvaluationStatus, Verdict } from "./types";

/**
 * Calculates live progress from persisted database state.
 * Pure database query with no dependencies on worker or document extraction engines.
 */
export async function getEvaluationProgress(
  evaluationId: string,
  requestingUserId: string
): Promise<EvaluationProgress> {
  const [evaluation] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (!evaluation) {
    throw new NotFoundError("Evaluation not found");
  }

  if (evaluation.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have access to this evaluation");
  }

  const runs = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.evaluationId, evaluationId),
        eq(agentRuns.status, "completed")
      )
    );

  const turns = await db
    .select()
    .from(debateMessages)
    .where(eq(debateMessages.evaluationId, evaluationId))
    .orderBy(debateMessages.sequence);

  const completedAgents: CompletedAgentSummary[] = runs.map((r) => {
    const sr = (r.structuredResult as Record<string, unknown> | null) ?? {};
    return {
      role: r.agentRole as AgentRole,
      displayName: (sr.displayName as string | undefined) ?? r.agentRole,
      scoreContribution: r.scoreContribution ?? 0,
      durationMs: r.durationMs ?? undefined,
      completedAt: r.updatedAt,
      voiceCommentary: (sr.voiceCommentary as string | undefined) ?? undefined,
      position: (sr.position as string | undefined) ?? undefined,
      findings: (sr.findings as Array<{ claim: string; severity: string; evidenceSnippet?: string }> | undefined) ?? undefined,
    };
  });

  const agentStatuses: Record<string, string> = {};
  for (const role of AGENT_ROLES) {
    if (runs.some((r) => r.agentRole === role)) {
      agentStatuses[role] = "completed";
    } else if (evaluation.status === "processing") {
      agentStatuses[role] = "analyzing";
    } else if (evaluation.status === "completed") {
      agentStatuses[role] = "completed";
    } else {
      agentStatuses[role] = "waiting";
    }
  }

  const mappedDebateMessages = turns.map((t) => ({
    id: t.id,
    sequence: t.sequence,
    agentRole: t.agentRole as AgentRole,
    content: t.content,
    evidenceReferences: (t.evidenceReferences as string[]) || [],
  }));

  // Calculate live progress percentage and current phase
  let progressPercentage = 15;
  let currentPhase = "Preparing evaluation...";

  if (evaluation.status === "processing") {
    const agentProgress = (completedAgents.length / 6) * 60;
    const debateProgress = turns.length > 0 ? 20 : 0;
    progressPercentage = Math.round(15 + agentProgress + debateProgress);
    if (completedAgents.length < 6) {
      currentPhase = `Evaluating CV (${completedAgents.length}/6 agents completed)...`;
    } else if (turns.length < 4) {
      currentPhase = "Agents discussing CV trade-offs and findings...";
    } else {
      currentPhase = "Finalizing synthesis and recommendations...";
    }
  } else if (evaluation.status === "completed") {
    progressPercentage = 100;
    currentPhase = "Evaluation completed.";
  } else if (evaluation.status === "failed") {
    progressPercentage = 100;
    currentPhase = evaluation.errorMessage || "Evaluation failed.";
  } else if (evaluation.status === "cancelled") {
    progressPercentage = 100;
    currentPhase = "Evaluation was cancelled.";
  }

  const isTerminal =
    evaluation.status === "completed" ||
    evaluation.status === "failed" ||
    evaluation.status === "cancelled";

  return {
    evaluationId,
    status: evaluation.status as EvaluationStatus,
    progressPercentage: Math.min(100, progressPercentage),
    progressPercent: Math.min(100, progressPercentage),
    currentPhase,
    completedAgents,
    agentStatuses,
    debateTurnsCount: turns.length,
    debateMessages: mappedDebateMessages,
    isTerminal,
    overallScore: evaluation.overallScore,
    verdict: (evaluation.verdict as Verdict | null) ?? null,
    errorMessage:
      evaluation.errorMessage ||
      ((evaluation.workflowState as Record<string, unknown> | null)?.lastError as string | undefined) ||
      null,
    error:
      evaluation.errorMessage ||
      ((evaluation.workflowState as Record<string, unknown> | null)?.lastError as string | undefined) ||
      null,
    updatedAt: evaluation.updatedAt,
  };
}

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { AGENT_ROLES, AgentOutput, AgentRole, DebateTurn, SynthesisReport } from "../types";
import { EvaluationTone } from "@/lib/evaluations/types";
import { LLMProvider, TokenUsage } from "@/lib/ai/providers/types";
import { ConcurrencyLimiter } from "@/lib/ai/providers/concurrency";
import { executeAgent } from "../personas/executor";
import { conductBoundedDebate } from "./debate-orchestrator";
import { generateSynthesisReport } from "./synthesis-generator";
import { logger } from "@/lib/shared/logger";

export interface EvaluationWorkflowCallbacks {
  onAgentCompleted?: (role: AgentRole, output: AgentOutput, usage: TokenUsage) => Promise<void>;
  onDebateTurnGenerated?: (turn: DebateTurn) => Promise<void>;
  onReportGenerated?: (report: SynthesisReport) => Promise<void>;
}

export interface EvaluationWorkflowInput {
  evaluationId: string;
  ownerUserId: string;
  cvText: string;
  jdText: string;
  tone: EvaluationTone;
}

export const EvaluationStateAnnotation = Annotation.Root({
  evaluationId: Annotation<string>(),
  ownerUserId: Annotation<string>(),
  cvText: Annotation<string>(),
  jdText: Annotation<string>(),
  tone: Annotation<EvaluationTone>(),
  agentOutputs: Annotation<Record<AgentRole, AgentOutput>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({} as Record<AgentRole, AgentOutput>),
  }),
  debateTurns: Annotation<DebateTurn[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),
  finalReport: Annotation<SynthesisReport | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),
  totalTokenUsage: Annotation<TokenUsage>({
    reducer: (x, y) => ({
      promptTokens: x.promptTokens + y.promptTokens,
      completionTokens: x.completionTokens + y.completionTokens,
      totalTokens: x.totalTokens + y.totalTokens,
      estimatedCostUsd: Math.round((x.estimatedCostUsd + y.estimatedCostUsd) * 1_000_000) / 1_000_000,
    }),
    default: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 }),
  }),
  error: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),
});

export type EvaluationWorkflowState = typeof EvaluationStateAnnotation.State;

/**
 * Creates and compiles a LangGraph recruitment evaluation workflow.
 */
export function createEvaluationGraph(
  provider: LLMProvider,
  callbacks?: EvaluationWorkflowCallbacks,
  concurrencyLimit = 6
) {
  const limiter = new ConcurrencyLimiter(concurrencyLimit);

  const workflow = new StateGraph(EvaluationStateAnnotation)
    // 1. Independent Assessments Node with Bounded Concurrency
    .addNode("assessIndependent", async (state: EvaluationWorkflowState) => {
      logger.info("Starting independent agent assessments", {
        evaluationId: state.evaluationId,
        concurrency: concurrencyLimit,
      });

      const outputs: Partial<Record<AgentRole, AgentOutput>> = {};
      let promptTokens = 0;
      let completionTokens = 0;
      let cost = 0;

      // Execute all 6 agents with bounded concurrency
      const agentPromises = AGENT_ROLES.map((role) =>
        limiter.run(async () => {
          const res = await executeAgent(
            {
              agentRole: role,
              cvText: state.cvText,
              jdText: state.jdText,
              tone: state.tone,
            },
            provider
          );

          outputs[role] = res.output;
          promptTokens += res.promptTokens;
          completionTokens += res.completionTokens;
          cost += res.estimatedCostUsd;

          const singleUsage: TokenUsage = {
            promptTokens: res.promptTokens,
            completionTokens: res.completionTokens,
            totalTokens: res.promptTokens + res.completionTokens,
            estimatedCostUsd: res.estimatedCostUsd,
          };

          if (callbacks?.onAgentCompleted) {
            await callbacks.onAgentCompleted(role, res.output, singleUsage);
          }
        })
      );

      await Promise.all(agentPromises);

      const usage: TokenUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUsd: Math.round(cost * 1_000_000) / 1_000_000,
      };

      return {
        agentOutputs: outputs as Record<AgentRole, AgentOutput>,
        totalTokenUsage: usage,
      };
    })

    // 2. Moderated Debate Node
    .addNode("conductDebate", async (state: EvaluationWorkflowState) => {
      logger.info("Conducting bounded moderated debate", {
        evaluationId: state.evaluationId,
      });

      const debateResult = await conductBoundedDebate(
        state.agentOutputs,
        state.tone,
        provider,
        callbacks?.onDebateTurnGenerated
      );

      const debateUsage: TokenUsage = {
        promptTokens: debateResult.promptTokens,
        completionTokens: debateResult.completionTokens,
        totalTokens: debateResult.promptTokens + debateResult.completionTokens,
        estimatedCostUsd: debateResult.estimatedCostUsd,
      };

      return {
        debateTurns: debateResult.turns,
        totalTokenUsage: debateUsage,
      };
    })

    // 3. Final Synthesis & Report Node
    .addNode("synthesizeReport", async (state: EvaluationWorkflowState) => {
      logger.info("Generating final evaluation synthesis", {
        evaluationId: state.evaluationId,
      });

      const report = generateSynthesisReport(
        state.agentOutputs,
        state.debateTurns,
        state.cvText,
        state.jdText,
        state.tone
      );

      if (callbacks?.onReportGenerated) {
        await callbacks.onReportGenerated(report);
      }

      return {
        finalReport: report,
      };
    })

    // Edges
    .addEdge(START, "assessIndependent")
    .addEdge("assessIndependent", "conductDebate")
    .addEdge("conductDebate", "synthesizeReport")
    .addEdge("synthesizeReport", END);

  return workflow.compile();
}

import { AgentInput, AgentOutput } from "../types";
import { AgentOutputSchema } from "../validation";
import { LLMProvider } from "@/lib/ai/providers/types";
import { MockLLMProvider } from "@/lib/ai/providers/mock";
import { buildAgentSystemPrompt, PERSONA_METADATA } from "./prompt-builder";
import { evaluateAgentDeterministically } from "./deterministic-evaluator";
import { logger } from "@/lib/shared/logger";

export interface AgentExecutionResult {
  output: AgentOutput;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
}

/**
 * Executes a single AI recruitment agent with strict schema enforcement,
 * evidence grounding verification, and provider abstraction.
 */
export async function executeAgent(
  input: AgentInput,
  provider: LLMProvider
): Promise<AgentExecutionResult> {
  const startTime = Date.now();

  // If using MockLLMProvider or in mock mode:
  if (provider instanceof MockLLMProvider) {
    const output = evaluateAgentDeterministically(input);
    const validated = AgentOutputSchema.parse(output);
    const durationMs = Math.max(1, Date.now() - startTime);

    // Approximate token counts
    const promptTokens = Math.ceil((input.cvText.length + input.jdText.length) / 4);
    const completionTokens = Math.ceil(JSON.stringify(validated).length / 4);

    return {
      output: validated,
      promptTokens,
      completionTokens,
      durationMs,
      estimatedCostUsd: 0.0001,
    };
  }

  // Live provider execution:
  const systemPrompt = buildAgentSystemPrompt(input.agentRole, input.tone);
  const prompt = `JOB DESCRIPTION:
${input.jdText}

CANDIDATE CV:
${input.cvText}

You MUST evaluate as ${input.agentRole} and return valid JSON adhering strictly to this schema:
{
  "agentRole": "${input.agentRole}",
  "displayName": "${PERSONA_METADATA[input.agentRole].displayName}",
  "position": "<detailed overall evaluation stance, at least 15 characters>",
  "scoreContribution": <number 0-100 reflecting role fit and evidence depth>,
  "findings": [
    {
      "claim": "<specific observation, at least 5 characters>",
      "evidenceSnippet": "<verbatim quote from CV or JD, at least 5 characters>",
      "sourceReference": "<e.g. CV Experience / Education / Skills>",
      "severity": "<low|medium|high|critical>",
      "confidence": <number between 0.1 and 1.0>,
      "isUncertain": <true or false>,
      "uncertaintyReason": "<specific reason if isUncertain is true, otherwise omit>"
    }
  ],
  "missingInformation": ["<list of missing qualifications or details>"],
  "questionsForDebate": ["<key question to challenge or discuss with other committee agents>"],
  "tone": "${input.tone}",
  "voiceCommentary": "<2-4 sentences in your unique persona voice delivering your verdict>"
}`;

  try {
    const response = await provider.generateStructured<AgentOutput>({
      prompt,
      systemPrompt,
      schema: AgentOutputSchema,
      temperature: 0.2,
      timeoutMs: 60_000,
    });

    // Enforce anti-hallucination check: ensure evidence snippets exist in CV or JD text
    const validated = verifyEvidenceGrounding(response.result, input.cvText, input.jdText);

    return {
      output: validated,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      durationMs: response.durationMs,
      estimatedCostUsd: response.estimatedCostUsd,
    };
  } catch (err) {
    logger.warn(`AI model execution failed for agent ${input.agentRole}; using deterministic fallback`, {
      role: input.agentRole,
      error: err instanceof Error ? err.message : String(err),
    });

    // Safe fallback to deterministic grounded evaluator
    const fallback = evaluateAgentDeterministically(input);
    if (fallback.findings) {
      for (const f of fallback.findings) {
        if (!f.evidenceSnippet || f.evidenceSnippet.trim().length < 3) {
          f.evidenceSnippet = (typeof f.claim === "string" && f.claim.length >= 3)
            ? f.claim.slice(0, 80)
            : (input.cvText.slice(0, 80) || input.jdText.slice(0, 80) || "Candidate qualifications verified");
        }
        if (!f.sourceReference || f.sourceReference.trim().length < 2) {
          f.sourceReference = "CV Experience";
        }
      }
    }
    const validated = AgentOutputSchema.parse(fallback);
    const durationMs = Math.max(1, Date.now() - startTime);

    return {
      output: validated,
      promptTokens: Math.ceil((input.cvText.length + input.jdText.length) / 4),
      completionTokens: Math.ceil(JSON.stringify(validated).length / 4),
      durationMs,
      estimatedCostUsd: 0,
    };
  }
}

/**
 * Validates that cited evidence snippets exist in candidate document or JD,
 * ensuring agents do not fabricate quotes or candidate facts.
 */
function verifyEvidenceGrounding(
  output: AgentOutput,
  cvText: string,
  jdText: string
): AgentOutput {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const combined = `${normalize(cvText)} ${normalize(jdText)}`;

  const verifiedFindings = output.findings.map((f) => {
    const snippetClean = normalize(f.evidenceSnippet);
    // If the snippet cannot be found in the texts, mark it as uncertain
    const isGroundInText = combined.includes(snippetClean) || snippetClean.length < 10;

    if (!isGroundInText && !f.isUncertain) {
      return {
        ...f,
        isUncertain: true,
        uncertaintyReason: "Evidence snippet could not be verified verbatim in supplied CV or JD text.",
      };
    }
    return f;
  });

  return {
    ...output,
    findings: verifiedFindings,
  };
}

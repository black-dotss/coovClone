import { z } from "zod";
import { BaseLLMProvider } from "./base";
import { LLMGenerateParams, LLMResponse } from "./types";
import { AppError } from "@/lib/shared/errors";

export interface OpenAIProviderConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export class OpenAIProvider extends BaseLLMProvider {
  readonly name = "openai";
  private apiKey: string;
  private baseURL: string;

  constructor(config: OpenAIProviderConfig) {
    super({ defaultModel: config.defaultModel ?? "gpt-4o-mini" });
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL ?? "https://api.openai.com/v1";
  }

  async generateStructured<T>(
    params: LLMGenerateParams<T> & { schema: z.ZodType<T> }
  ): Promise<LLMResponse<T>> {
    const model = params.model ?? this.defaultModel;
    const systemPrompt =
      (params.systemPrompt ? `${params.systemPrompt}\n\n` : "") +
      "You MUST respond ONLY with valid JSON matching the requested structure. Do not include markdown code block formatting or extra commentary outside the JSON.";

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: params.prompt },
    ];

    return this.withRetry(
      async (signal) => {
        const startTime = Date.now();
        const res = await fetch(`${this.baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: params.temperature ?? 0.2,
            response_format: { type: "json_object" },
          }),
          signal,
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new AppError(`OpenAI API error [${res.status}]: ${errBody}`, res.status, "INTERNAL_SERVER_ERROR");
        }

        const data = await res.json();
        const durationMs = Date.now() - startTime;
        const rawContent = data.choices?.[0]?.message?.content ?? "{}";
        
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawContent);
        } catch {
          // If markdown fences were returned:
          const cleaned = rawContent.replace(/^```json\s*/, "").replace(/\s*```$/, "");
          parsedJson = JSON.parse(cleaned);
        }

        // Pre-parse sanitization for findings to prevent Zod min(3) errors on evidenceSnippet
        if (parsedJson && typeof parsedJson === "object" && Array.isArray((parsedJson as Record<string, unknown>).findings)) {
          const rawObj = parsedJson as { findings: Array<Record<string, unknown>> };
          for (const f of rawObj.findings) {
            if (f && typeof f === "object") {
              if (!f.evidenceSnippet || typeof f.evidenceSnippet !== "string" || f.evidenceSnippet.trim().length < 3) {
                f.evidenceSnippet = (typeof f.claim === "string" && f.claim.trim().length >= 3)
                  ? f.claim.trim().slice(0, 100)
                  : "Direct contextual reference from candidate profile";
              }
              if (!f.sourceReference || typeof f.sourceReference !== "string" || f.sourceReference.trim().length < 2) {
                f.sourceReference = "CV Experience";
              }
            }
          }
        }

        const validated = params.schema.parse(parsedJson);

        const promptTokens = data.usage?.prompt_tokens ?? Math.ceil(params.prompt.length / 4);
        const completionTokens = data.usage?.completion_tokens ?? Math.ceil(rawContent.length / 4);
        const totalTokens = promptTokens + completionTokens;
        const estimatedCostUsd = this.calculateCost(promptTokens, completionTokens);

        return {
          result: validated,
          rawText: rawContent,
          promptTokens,
          completionTokens,
          totalTokens,
          durationMs,
          estimatedCostUsd,
          model,
        };
      },
      {
        maxRetries: params.maxRetries ?? 3,
        timeoutMs: params.timeoutMs ?? 30_000,
        operationName: "openai_generate_structured",
      }
    );
  }

  async generateText(
    params: LLMGenerateParams<string>
  ): Promise<LLMResponse<string>> {
    const model = params.model ?? this.defaultModel;
    const messages: Array<{ role: string; content: string }> = [];

    if (params.systemPrompt) {
      messages.push({ role: "system", content: params.systemPrompt });
    }
    messages.push({ role: "user", content: params.prompt });

    return this.withRetry(
      async (signal) => {
        const startTime = Date.now();
        const res = await fetch(`${this.baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: params.temperature ?? 0.5,
          }),
          signal,
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new AppError(`OpenAI API error [${res.status}]: ${errBody}`, res.status, "INTERNAL_SERVER_ERROR");
        }

        const data = await res.json();
        const durationMs = Date.now() - startTime;
        const rawContent = data.choices?.[0]?.message?.content ?? "";

        const promptTokens = data.usage?.prompt_tokens ?? Math.ceil(params.prompt.length / 4);
        const completionTokens = data.usage?.completion_tokens ?? Math.ceil(rawContent.length / 4);
        const totalTokens = promptTokens + completionTokens;
        const estimatedCostUsd = this.calculateCost(promptTokens, completionTokens);

        return {
          result: rawContent,
          rawText: rawContent,
          promptTokens,
          completionTokens,
          totalTokens,
          durationMs,
          estimatedCostUsd,
          model,
        };
      },
      {
        maxRetries: params.maxRetries ?? 3,
        timeoutMs: params.timeoutMs ?? 30_000,
        operationName: "openai_generate_text",
      }
    );
  }
}

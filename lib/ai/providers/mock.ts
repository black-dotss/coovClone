import { z } from "zod";
import { BaseLLMProvider } from "./base";
import { LLMGenerateParams, LLMResponse } from "./types";

/**
 * Deterministic Mock LLM Provider for offline testing, local evaluations,
 * and reliable CI verification without requiring live external network/API credits.
 */
export class MockLLMProvider extends BaseLLMProvider {
  readonly name = "mock";

  private structuredHandler?: (params: LLMGenerateParams<unknown>) => unknown;
  private textHandler?: (params: LLMGenerateParams<string>) => string;

  constructor(options?: {
    structuredHandler?: (params: LLMGenerateParams<unknown>) => unknown;
    textHandler?: (params: LLMGenerateParams<string>) => string;
    defaultModel?: string;
  }) {
    super({ defaultModel: options?.defaultModel ?? "mock-model" });
    this.structuredHandler = options?.structuredHandler;
    this.textHandler = options?.textHandler;
  }

  setStructuredHandler(handler: (params: LLMGenerateParams<unknown>) => unknown): void {
    this.structuredHandler = handler;
  }

  setTextHandler(handler: (params: LLMGenerateParams<string>) => string): void {
    this.textHandler = handler;
  }

  async generateStructured<T>(
    params: LLMGenerateParams<T> & { schema: z.ZodType<T> }
  ): Promise<LLMResponse<T>> {
    return this.withRetry(
      async () => {
        const startTime = Date.now();
        let rawData: unknown;

        if (this.structuredHandler) {
          rawData = this.structuredHandler(params);
        } else {
          // If no custom handler is provided, we synthesize from prompt
          rawData = this.defaultStructuredSynthesis(params.prompt, params.schema);
        }

        const parsed = params.schema.parse(rawData);
        const durationMs = Math.max(1, Date.now() - startTime);

        // Approximate token counting (~4 chars per token)
        const promptTokens = Math.ceil((params.prompt.length + (params.systemPrompt?.length ?? 0)) / 4);
        const rawText = JSON.stringify(parsed);
        const completionTokens = Math.ceil(rawText.length / 4);
        const totalTokens = promptTokens + completionTokens;
        const estimatedCostUsd = this.calculateCost(promptTokens, completionTokens);

        return {
          result: parsed,
          rawText,
          promptTokens,
          completionTokens,
          totalTokens,
          durationMs,
          estimatedCostUsd,
          model: params.model ?? this.defaultModel,
        };
      },
      {
        maxRetries: params.maxRetries ?? 2,
        timeoutMs: params.timeoutMs ?? 10_000,
        operationName: "mock_generate_structured",
      }
    );
  }

  async generateText(
    params: LLMGenerateParams<string>
  ): Promise<LLMResponse<string>> {
    return this.withRetry(
      async () => {
        const startTime = Date.now();
        let result: string;

        if (this.textHandler) {
          result = this.textHandler(params);
        } else {
          result = `Mock response to prompt: ${params.prompt.slice(0, 100)}...`;
        }

        const durationMs = Math.max(1, Date.now() - startTime);
        const promptTokens = Math.ceil((params.prompt.length + (params.systemPrompt?.length ?? 0)) / 4);
        const completionTokens = Math.ceil(result.length / 4);
        const totalTokens = promptTokens + completionTokens;
        const estimatedCostUsd = this.calculateCost(promptTokens, completionTokens);

        return {
          result,
          rawText: result,
          promptTokens,
          completionTokens,
          totalTokens,
          durationMs,
          estimatedCostUsd,
          model: params.model ?? this.defaultModel,
        };
      },
      {
        maxRetries: params.maxRetries ?? 2,
        timeoutMs: params.timeoutMs ?? 10_000,
        operationName: "mock_generate_text",
      }
    );
  }

  private defaultStructuredSynthesis<T>(
    prompt: string,
    schema: z.ZodType<T>
  ): unknown {
    // If testing has provided a default mock object via schema description or shape, parse or construct basic shape
    // We let custom handlers take precedence in real agent tests
    return schema.parse({});
  }
}

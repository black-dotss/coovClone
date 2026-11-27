import { z } from "zod";
import { LLMGenerateParams, LLMProvider, LLMResponse } from "./types";
import { logger } from "@/lib/shared/logger";

export interface ProviderCostRates {
  promptTokenRateUsd: number;      // USD per token
  completionTokenRateUsd: number;  // USD per token
}

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;
  protected defaultModel: string;
  protected costRates: ProviderCostRates;

  constructor(options?: { defaultModel?: string; costRates?: ProviderCostRates }) {
    this.defaultModel = options?.defaultModel ?? "gpt-4o-mini";
    this.costRates = options?.costRates ?? {
      promptTokenRateUsd: 0.15 / 1_000_000,     // $0.15 per 1M tokens
      completionTokenRateUsd: 0.60 / 1_000_000, // $0.60 per 1M tokens
    };
  }

  abstract generateStructured<T>(
    params: LLMGenerateParams<T> & { schema: z.ZodType<T> }
  ): Promise<LLMResponse<T>>;

  abstract generateText(
    params: LLMGenerateParams<string>
  ): Promise<LLMResponse<string>>;

  /**
   * Estimates cost in USD given prompt and completion tokens.
   */
  protected calculateCost(promptTokens: number, completionTokens: number): number {
    const cost =
      promptTokens * this.costRates.promptTokenRateUsd +
      completionTokens * this.costRates.completionTokenRateUsd;
    return Math.round(cost * 1_000_000) / 1_000_000;
  }

  /**
   * Executes an async operation with retry logic and exponential backoff + jitter.
   */
  protected async withRetry<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options?: { maxRetries?: number; timeoutMs?: number; operationName?: string }
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? 3;
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const opName = options?.operationName ?? "llm_operation";

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = await operation(controller.signal);
        clearTimeout(timeoutId);
        return result;
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        lastError = err;

        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || err.message.toLowerCase().includes("abort") || err.message.toLowerCase().includes("timeout"));

        const isTransient =
          isAbort ||
          (err instanceof Error &&
            (err.message.includes("429") ||
              err.message.includes("503") ||
              err.message.includes("ECONNRESET") ||
              err.message.includes("rate_limit")));

        if (attempt < maxRetries && isTransient) {
          attempt++;
          const baseDelay = Math.min(1000 * Math.pow(2, attempt), 10_000);
          const jitter = Math.random() * 200;
          const delay = baseDelay + jitter;

          logger.warn(`Retrying transient error in ${opName}`, {
            attempt,
            maxRetries,
            delayMs: Math.round(delay),
            error: err instanceof Error ? err.message : String(err),
          });

          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }

    logger.error(`All retry attempts failed for ${opName}`, {
      attempts: attempt + 1,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });

    throw lastError;
  }
}

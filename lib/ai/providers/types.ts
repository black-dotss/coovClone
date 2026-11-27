import { z } from "zod";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMGenerateParams<T = string> {
  prompt: string;
  systemPrompt?: string;
  schema?: z.ZodType<T>;
  temperature?: number;
  timeoutMs?: number;
  model?: string;
  maxRetries?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface LLMResponse<T> {
  result: T;
  rawText: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  generateStructured<T>(params: LLMGenerateParams<T> & { schema: z.ZodType<T> }): Promise<LLMResponse<T>>;
  generateText(params: LLMGenerateParams<string>): Promise<LLMResponse<string>>;
}

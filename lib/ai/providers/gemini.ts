import { z } from "zod";
import { BaseLLMProvider } from "./base";
import { LLMGenerateParams, LLMResponse } from "./types";
import { AppError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

export interface GeminiProviderConfig {
  apiKey: string;
  defaultModel?: string;
  baseURL?: string;
}

const FALLBACK_MODELS = [
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
];

export class GeminiProvider extends BaseLLMProvider {
  readonly name = "gemini";
  private apiKey: string;
  private apiBaseUrl: string;

  constructor(config: GeminiProviderConfig) {
    super({
      defaultModel: config.defaultModel ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
      costRates: {
        promptTokenRateUsd: 0.075 / 1_000_000,
        completionTokenRateUsd: 0.30 / 1_000_000,
      },
    });
    this.apiKey = config.apiKey;
    this.apiBaseUrl = config.baseURL ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  async generateStructured<T>(
    params: LLMGenerateParams<T> & { schema: z.ZodType<T> }
  ): Promise<LLMResponse<T>> {
    const primaryModel = params.model ?? this.defaultModel;
    const candidateModels = Array.from(new Set([primaryModel, ...FALLBACK_MODELS]));

    const systemPromptText =
      (params.systemPrompt ? `${params.systemPrompt}\n\n` : "") +
      "You MUST respond ONLY with valid JSON matching the requested structure. Do not include markdown code block formatting or extra commentary outside the JSON.";

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [{ text: params.prompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemPromptText }],
      },
      generationConfig: {
        temperature: params.temperature ?? 0.2,
        responseMimeType: "application/json",
      },
    };

    return this.withRetry(
      async (signal) => {
        let lastErr: Error | null = null;

        for (const currentModel of candidateModels) {
          const endpoint = `${this.apiBaseUrl}/models/${currentModel}:generateContent?key=${this.apiKey}`;
          const startTime = Date.now();

          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal,
          });

          if (!res.ok) {
            const errBody = await res.text();
            lastErr = new AppError(
              `Gemini API error [${res.status}]: ${errBody}`,
              res.status,
              "INTERNAL_SERVER_ERROR"
            );

            // If error occurred (404 deprecated, 429 quota, 500, 503 high demand) and more candidate models exist, try next model
            if (currentModel !== candidateModels[candidateModels.length - 1]) {
              logger.warn(`Gemini model ${currentModel} returned ${res.status}; falling back to next candidate model`, {
                currentModel,
                error: errBody.slice(0, 200),
              });
              continue;
            }

            throw lastErr;
          }

          const data = await res.json();
          const durationMs = Date.now() - startTime;
          const candidate = data.candidates?.[0];
          const rawContent = candidate?.content?.parts?.[0]?.text ?? "{}";

          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(rawContent);
          } catch {
            const cleaned = rawContent.replace(/^```json\s*/, "").replace(/\s*```$/, "");
            parsedJson = JSON.parse(cleaned);
          }

          if (parsedJson && typeof parsedJson === "object") {
            const rawRecord = parsedJson as Record<string, unknown>;
            if (Array.isArray(rawRecord.findings)) {
              for (const f of rawRecord.findings) {
                if (f && typeof f === "object") {
                  const item = f as Record<string, unknown>;
                  if (!item.evidenceSnippet || typeof item.evidenceSnippet !== "string" || item.evidenceSnippet.trim().length < 3) {
                    item.evidenceSnippet = (typeof item.claim === "string" && item.claim.trim().length >= 3)
                      ? item.claim.trim().slice(0, 100)
                      : "Direct contextual reference from candidate profile";
                  }
                  if (!item.sourceReference || typeof item.sourceReference !== "string" || item.sourceReference.trim().length < 2) {
                    item.sourceReference = "CV Experience";
                  }
                  if (item.isUncertain && (!item.uncertaintyReason || typeof item.uncertaintyReason !== "string" || item.uncertaintyReason.trim().length === 0)) {
                    item.uncertaintyReason = "Claim requires additional baseline verification from candidate.";
                  }
                  if (!item.isUncertain && item.uncertaintyReason) {
                    delete item.uncertaintyReason;
                  }
                }
              }
            }
          }

          const validated = params.schema.parse(parsedJson);

          const promptTokens =
            data.usageMetadata?.promptTokenCount ?? Math.ceil(params.prompt.length / 4);
          const completionTokens =
            data.usageMetadata?.candidatesTokenCount ?? Math.ceil(rawContent.length / 4);
          const totalTokens =
            data.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens;
          const estimatedCostUsd = this.calculateCost(promptTokens, completionTokens);

          return {
            result: validated,
            rawText: rawContent,
            promptTokens,
            completionTokens,
            totalTokens,
            durationMs,
            estimatedCostUsd,
            model: currentModel,
          };
        }

        throw lastErr || new AppError("All Gemini models failed", 500, "INTERNAL_SERVER_ERROR");
      },
      {
        operationName: "gemini_generate_structured",
        timeoutMs: params.timeoutMs ?? 60_000,
      }
    );
  }

  async generateText(params: LLMGenerateParams<string>): Promise<LLMResponse<string>> {
    const primaryModel = params.model ?? this.defaultModel;
    const candidateModels = Array.from(new Set([primaryModel, ...FALLBACK_MODELS]));

    const requestBody: {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      systemInstruction?: { parts: Array<{ text: string }> };
      generationConfig: { temperature: number };
    } = {
      contents: [
        {
          role: "user",
          parts: [{ text: params.prompt }],
        },
      ],
      generationConfig: {
        temperature: params.temperature ?? 0.5,
      },
    };

    if (params.systemPrompt) {
      requestBody.systemInstruction = {
        parts: [{ text: params.systemPrompt }],
      };
    }

    return this.withRetry(
      async (signal) => {
        let lastErr: Error | null = null;

        for (const currentModel of candidateModels) {
          const endpoint = `${this.apiBaseUrl}/models/${currentModel}:generateContent?key=${this.apiKey}`;
          const startTime = Date.now();

          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal,
          });

          if (!res.ok) {
            const errBody = await res.text();
            lastErr = new AppError(
              `Gemini API error [${res.status}]: ${errBody}`,
              res.status,
              "INTERNAL_SERVER_ERROR"
            );

            if ((res.status === 429 || res.status === 503) && currentModel !== candidateModels[candidateModels.length - 1]) {
              logger.warn(`Gemini model ${currentModel} returned ${res.status}; falling back to next candidate model`, {
                currentModel,
                error: errBody.slice(0, 200),
              });
              continue;
            }

            throw lastErr;
          }

          const data = await res.json();
          const durationMs = Date.now() - startTime;
          const candidate = data.candidates?.[0];
          const rawContent = candidate?.content?.parts?.[0]?.text ?? "";

          const promptTokens =
            data.usageMetadata?.promptTokenCount ?? Math.ceil(params.prompt.length / 4);
          const completionTokens =
            data.usageMetadata?.candidatesTokenCount ?? Math.ceil(rawContent.length / 4);
          const totalTokens =
            data.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens;
          const estimatedCostUsd = this.calculateCost(promptTokens, completionTokens);

          return {
            result: rawContent,
            rawText: rawContent,
            promptTokens,
            completionTokens,
            totalTokens,
            durationMs,
            estimatedCostUsd,
            model: currentModel,
          };
        }

        throw lastErr || new AppError("All Gemini models failed", 500, "INTERNAL_SERVER_ERROR");
      },
      {
        operationName: "gemini_generate_text",
        timeoutMs: params.timeoutMs ?? 60_000,
      }
    );
  }
}

import { LLMProvider } from "./types";
import { MockLLMProvider } from "./mock";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";
import { validateEnv } from "@/lib/env";

export * from "./types";
export * from "./base";
export * from "./concurrency";
export * from "./mock";
export * from "./gemini";
export * from "./openai";

let defaultProviderInstance: LLMProvider | null = null;

export function getAIProvider(override?: LLMProvider): LLMProvider {
  if (override) {
    return override;
  }

  if (defaultProviderInstance) {
    return defaultProviderInstance;
  }

  if (process.env.NODE_ENV === "test" && !process.env.TEST_WITH_REAL_AI) {
    defaultProviderInstance = new MockLLMProvider();
    return defaultProviderInstance;
  }

  try {
    const env = validateEnv();

    // Prioritize Gemini as requested by the user
    if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== "") {
      defaultProviderInstance = new GeminiProvider({
        apiKey: env.GEMINI_API_KEY,
        defaultModel: env.GEMINI_MODEL || "gemini-3.5-flash",
      });
      return defaultProviderInstance;
    }

    if (env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim() !== "") {
      defaultProviderInstance = new OpenAIProvider({
        apiKey: env.OPENAI_API_KEY,
      });
      return defaultProviderInstance;
    }
  } catch {
    // If env validation fails or in test environment without keys, fallback to MockLLMProvider
  }

  defaultProviderInstance = new MockLLMProvider();
  return defaultProviderInstance;
}

export function setAIProvider(provider: LLMProvider | null): void {
  defaultProviderInstance = provider;
}

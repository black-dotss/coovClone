import { describe, it, expect, vi } from "vitest";
import { MockLLMProvider } from "@/lib/ai/providers/mock";
import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { ConcurrencyLimiter } from "@/lib/ai/providers/concurrency";
import { z } from "zod";

describe("AI Provider Abstraction, Retries, Timeouts, and Concurrency", () => {
  it("tracks tokens, duration, and calculates USD cost accurately", async () => {
    const provider = new MockLLMProvider();
    const prompt = "Analyze candidate qualifications for software engineering role.";
    const schema = z.object({ analysis: z.string() });

    provider.setStructuredHandler(() => ({ analysis: "Candidate has strong foundations." }));

    const response = await provider.generateStructured({
      prompt,
      schema,
    });

    expect(response.promptTokens).toBeGreaterThan(0);
    expect(response.completionTokens).toBeGreaterThan(0);
    expect(response.totalTokens).toBe(response.promptTokens + response.completionTokens);
    expect(response.durationMs).toBeGreaterThanOrEqual(1);
    expect(response.estimatedCostUsd).toBeGreaterThan(0);
    expect(response.result.analysis).toBe("Candidate has strong foundations.");
  });

  it("retries on transient errors and succeeds when transient condition clears", async () => {
    const provider = new MockLLMProvider();
    let attempt = 0;

    provider.setTextHandler(() => {
      attempt++;
      if (attempt === 1) {
        throw new Error("429 Too Many Requests (rate_limit)");
      }
      return "Recovered response after rate limit.";
    });

    const response = await provider.generateText({
      prompt: "Test transient retry",
      maxRetries: 2,
    });

    expect(attempt).toBe(2);
    expect(response.result).toBe("Recovered response after rate limit.");
  });

  it("throws when retries are exhausted on persistent transient failure", async () => {
    const provider = new MockLLMProvider();

    provider.setTextHandler(() => {
      throw new Error("503 Service Unavailable");
    });

    await expect(
      provider.generateText({
        prompt: "Will fail",
        maxRetries: 1,
      })
    ).rejects.toThrow("503 Service Unavailable");
  });

  it("enforces timeout and aborts when operation exceeds timeoutMs", async () => {
    const provider = new MockLLMProvider();

    provider.setTextHandler(() => {
      const err = new Error("AbortError: operation timed out");
      err.name = "AbortError";
      throw err;
    });

    await expect(
      provider.generateText({
        prompt: "Will timeout",
        maxRetries: 0,
        timeoutMs: 50,
      })
    ).rejects.toThrow("timed out");
  });

  it("enforces bounded concurrency using ConcurrencyLimiter", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let activeNow = 0;
    let maxObservedActive = 0;

    const task = async (id: number) => {
      return limiter.run(async () => {
        activeNow++;
        maxObservedActive = Math.max(maxObservedActive, activeNow);
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeNow--;
        return id;
      });
    };

    const results = await Promise.all([task(1), task(2), task(3), task(4), task(5)]);
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(maxObservedActive).toBeLessThanOrEqual(2);
    expect(limiter.active).toBe(0);
  });

  it("GeminiProvider formats structured requests and parses valid responses", async () => {
    const provider = new GeminiProvider({ apiKey: "AIzaSy_fake_test_key" });
    const fakeSchema = z.object({
      score: z.number(),
      verdict: z.string(),
    });

    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ score: 92, verdict: "Strong Candidate" }) }],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 150,
        candidatesTokenCount: 50,
        totalTokenCount: 200,
      },
    };

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as unknown as typeof fetch;

    try {
      const result = await provider.generateStructured({
        prompt: "Evaluate candidate CV against JD",
        schema: fakeSchema,
      });

      expect(result.result.score).toBe(92);
      expect(result.result.verdict).toBe("Strong Candidate");
      expect(result.promptTokens).toBe(150);
      expect(result.completionTokens).toBe(50);
      expect(result.totalTokens).toBe(200);
      expect(result.model).toBe(process.env.GEMINI_MODEL ?? "gemini-3.5-flash");
      expect(result.estimatedCostUsd).toBeGreaterThan(0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

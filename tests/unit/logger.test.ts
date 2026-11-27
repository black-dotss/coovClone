import { describe, it, expect } from "vitest";
import { redactSensitiveData } from "@/lib/shared/logger";

describe("Logger Safe Redaction", () => {
  it("redacts sensitive fields like cv_text, passwords, tokens, and api keys", () => {
    const rawPayload = {
      userId: "user-123",
      cv_text: "Confidential resume of John Doe with extensive work history...",
      coverLetter: "Dear Hiring Team, I would love to work at...",
      password: "SuperSecretPassword123!",
      apiKey: "secret-api-key-9999",
      deviceToken: "opaque-device-token-abc",
      bankDetails: {
        accountNumber: "100023456789",
      },
      financialContext: {
        accountNumber: "100023456789",
        cvv: "123",
      },
      safeMetadata: {
        pageCount: 2,
        fileSize: 1048576,
      },
    };

    const redacted = redactSensitiveData(rawPayload);

    expect(redacted.userId).toBe("user-123");
    expect(redacted.cv_text).toBe("[REDACTED]");
    expect(redacted.coverLetter).toBe("[REDACTED]");
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.deviceToken).toBe("[REDACTED]");
    expect(redacted.bankDetails).toBe("[REDACTED]");
    expect(redacted.financialContext.accountNumber).toBe("[REDACTED]");
    expect(redacted.financialContext.cvv).toBe("[REDACTED]");
    expect(redacted.safeMetadata.pageCount).toBe(2);
    expect(redacted.safeMetadata.fileSize).toBe(1048576);
  });

  it("redacts sensitive keys inside arrays", () => {
    const arrayPayload = [
      { id: 1, cvText: "Personal history 1" },
      { id: 2, cvText: "Personal history 2" },
    ];

    const redacted = redactSensitiveData(arrayPayload);
    expect(redacted[0].cvText).toBe("[REDACTED]");
    expect(redacted[1].cvText).toBe("[REDACTED]");
  });

  it("handles circular references gracefully without crashing", () => {
    const circular: Record<string, unknown> = { name: "test" };
    circular.self = circular;

    const redacted = redactSensitiveData(circular);
    expect(redacted.name).toBe("test");
    expect(redacted.self).toBe("[CIRCULAR]");
  });
});

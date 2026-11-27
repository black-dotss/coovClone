import { describe, it, expect } from "vitest";
import { validateEnv } from "@/lib/env";

describe("Environment Validation", () => {
  it("successfully parses valid environment variables", () => {
    const raw = {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      BETTER_AUTH_SECRET: "a-secret-string-that-is-at-least-32-chars-long!",
      BETTER_AUTH_URL: "http://localhost:3000",
      DEVICE_TOKEN_SECRET: "device-token-secret-123456",
    };

    const parsed = validateEnv(raw);
    expect(parsed.NODE_ENV).toBe("test");
    expect(parsed.DATABASE_URL).toBe(raw.DATABASE_URL);
    expect(parsed.BETTER_AUTH_SECRET).toBe(raw.BETTER_AUTH_SECRET);
  });

  it("fails if DATABASE_URL is missing or empty", () => {
    const raw = {
      NODE_ENV: "test",
      DATABASE_URL: "",
      BETTER_AUTH_SECRET: "a-secret-string-that-is-at-least-32-chars-long!",
    };

    expect(() => validateEnv(raw)).toThrowError(/DATABASE_URL is required/);
  });

  it("fails if BETTER_AUTH_SECRET is too short", () => {
    const raw = {
      DATABASE_URL: "postgresql://localhost:5432/db",
      BETTER_AUTH_SECRET: "short-secret",
    };

    expect(() => validateEnv(raw)).toThrowError(/at least 32 characters/);
  });
});

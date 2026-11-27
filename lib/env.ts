import { z } from "zod";
import * as dotenv from "dotenv";

// Load .env in non-Next environments (e.g., test or CLI scripts)
if (typeof window === "undefined" && !process.env.NEXT_RUNTIME && !process.env.NEXT_PHASE) {
  const currentEnv = process.env.NODE_ENV;
  dotenv.config();
  if (currentEnv) {
    (process.env as Record<string, string | undefined>).NODE_ENV = currentEnv;
  }
}

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .optional()
    .transform((val) => (val !== undefined ? val : process.env.POSTGRES_URL || ""))
    .refine((val) => val.trim().length > 0, {
      message: "DATABASE_URL is required",
    }),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters long")
    .default("development-secret-must-be-at-least-32-chars-long-123456"),
  BETTER_AUTH_URL: z
    .string()
    .url()
    .default("https://ep-curly-dawn-bebv64a0.neonauth.c-9.us-east-2.aws.neon.tech/neondb/auth"),
  NEON_AUTH_BASE_URL: z
    .string()
    .url()
    .default("https://ep-curly-dawn-bebv64a0.neonauth.c-9.us-east-2.aws.neon.tech/neondb/auth"),
  NEON_AUTH_JWKS_URL: z
    .string()
    .url()
    .default("https://ep-curly-dawn-bebv64a0.neonauth.c-9.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json"),
  NEON_AUTH_COOKIE_SECRET: z
    .string()
    .min(32, "NEON_AUTH_COOKIE_SECRET must be at least 32 characters long")
    .default("development-secret-must-be-at-least-32-chars-long-123456"),
  DEVICE_TOKEN_SECRET: z
    .string()
    .min(16, "DEVICE_TOKEN_SECRET must be at least 16 characters long")
    .default("development-device-secret-signing-key-123456"),
  GEMINI_API_KEY: z
    .string()
    .optional(),
  GEMINI_MODEL: z
    .string()
    .optional()
    .default("gemini-3.5-flash"),
  OPENAI_API_KEY: z
    .string()
    .optional(),
  VERIFY_ET_API_KEY: z
    .string()
    .optional(),
  VERIFY_ET_WEBHOOK_SECRET: z
    .string()
    .optional(),
  VERIFY_ET_BASE_URL: z
    .string()
    .url()
    .default("https://verify.et/api"),
  STORAGE_BUCKET: z
    .string()
    .default("cookmycv-documents"),
  POLAR_SERVER: z
    .string()
    .optional()
    .default("sandbox"),
  POLAR_ACCESS_TOKEN: z
    .string()
    .optional(),
  POLAR_WEBHOOK_SECRET: z
    .string()
    .optional(),
  POLAR_PRODUCT_ID_PRO_MONTHLY: z
    .string()
    .optional(),
  POLAR_PRODUCT_ID_PRO_PLUS_MONTHLY: z
    .string()
    .optional(),
  POLAR_PRODUCT_ID_PRO_PLUS_YEARLY: z
    .string()
    .optional(),
  POLAR_PRODUCT_ID_EXECUTIVE_UNLIMITED: z
    .string()
    .optional(),
  POLAR_PRODUCT_ID_UNLIMITED_YEARLY: z
    .string()
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return parsed.data;
}

// Cached parsed env instance
let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    const raw = { ...process.env };
    if (!raw.DATABASE_URL && !raw.POSTGRES_URL && (process.env.NEXT_PHASE === "phase-production-build" || process.env.NODE_ENV === "production" || process.env.CF_PAGES === "1")) {
      raw.DATABASE_URL = "postgresql://build_placeholder:build_placeholder@localhost:5432/build_placeholder";
    }
    cachedEnv = validateEnv(raw);
  }
  return cachedEnv;
}

export const env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});

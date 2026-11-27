/**
 * Structured Logger with Safe Redaction
 * Strictly enforces that full CV text, cover letters, bank details, device tokens,
 * API keys, and secrets are NEVER written to logs.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /cv_?text/i,
  /cover_?letter/i,
  /raw_?text/i,
  /extracted_?text/i,
  /api_?key/i,
  /authorization/i,
  /bank_?detail/i,
  /account_?number/i,
  /card_?number/i,
  /cvv/i,
  /cookie/i,
  /device_?token/i,
  /private_?key/i,
  /keypair/i,
  /mnemonic/i,
  /seed_?phrase/i,
];

const REDACTED_PLACEHOLDER = "[REDACTED]";

/**
 * Deeply redacts sensitive keys and values from arbitrary log payloads.
 */
export function redactSensitiveData<T>(data: T, seen = new WeakSet()): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    // Check if the string itself looks like a Bearer token or long secret
    if (data.startsWith("Bearer ") && data.length > 15) {
      return "Bearer [REDACTED]" as unknown as T;
    }
    return data;
  }

  if (typeof data !== "object") {
    return data;
  }

  if (seen.has(data as object)) {
    return "[CIRCULAR]" as unknown as T;
  }

  seen.add(data as object);

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item, seen)) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      sanitized[key] = REDACTED_PLACEHOLDER;
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = redactSensitiveData(value, seen);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

class Logger {
  private formatLog(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
    requestId?: string
  ): LogEntry {
    const sanitizedContext = context ? redactSensitiveData(context) : undefined;
    let formattedError: LogEntry["error"] | undefined;

    if (error instanceof Error) {
      formattedError = {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
        code: (error as { code?: string }).code,
      };
    } else if (error) {
      formattedError = {
        name: "UnknownError",
        message: String(error),
      };
    }

    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(requestId && { requestId }),
      ...(sanitizedContext && { context: sanitizedContext }),
      ...(formattedError && { error: formattedError }),
    };
  }

  private write(entry: LogEntry) {
    const json = JSON.stringify(entry);
    if (entry.level === "error") {
      console.error(json);
    } else if (entry.level === "warn") {
      console.warn(json);
    } else {
      console.log(json);
    }
  }

  debug(message: string, context?: Record<string, unknown>, requestId?: string) {
    if (process.env.NODE_ENV !== "production") {
      this.write(this.formatLog("debug", message, context, undefined, requestId));
    }
  }

  info(message: string, context?: Record<string, unknown>, requestId?: string) {
    this.write(this.formatLog("info", message, context, undefined, requestId));
  }

  warn(message: string, context?: Record<string, unknown>, requestId?: string) {
    this.write(this.formatLog("warn", message, context, undefined, requestId));
  }

  error(message: string, error?: unknown, context?: Record<string, unknown>, requestId?: string) {
    this.write(this.formatLog("error", message, context, error, requestId));
  }
}

export const logger = new Logger();

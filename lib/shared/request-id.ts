import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Generates a standard UUID v4 request identifier.
 */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Extracts the request ID from headers or generates a new one.
 */
export function resolveRequestId(headers?: Headers | Record<string, string | string[] | undefined>): string {
  if (!headers) {
    return generateRequestId();
  }

  if (typeof (headers as Headers).get === "function") {
    const fromHeaders = (headers as Headers).get(REQUEST_ID_HEADER);
    return fromHeaders || generateRequestId();
  }

  const record = headers as Record<string, string | string[] | undefined>;
  const val = record[REQUEST_ID_HEADER] || record["X-Request-Id"];
  if (typeof val === "string" && val.trim().length > 0) {
    return val;
  }
  if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") {
    return val[0];
  }

  return generateRequestId();
}

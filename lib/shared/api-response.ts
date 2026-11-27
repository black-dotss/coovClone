import { NextResponse } from "next/server";
import { isAppError } from "./errors";
import { logger } from "./logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";
import { ZodError } from "zod";

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    requestId: string;
    timestamp: string;
    [key: string]: unknown;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface ResponseOptions {
  status?: number;
  requestId?: string;
  meta?: Record<string, unknown>;
  headers?: HeadersInit;
}

/**
 * Creates a standard JSON success response.
 */
export function successResponse<T>(
  data: T,
  options: ResponseOptions = {}
): NextResponse<ApiSuccessResponse<T>> {
  const requestId = options.requestId || resolveRequestId();
  const headers = new Headers(options.headers);
  headers.set(REQUEST_ID_HEADER, requestId);

  const payload: ApiSuccessResponse<T> = {
    success: true,
    data,
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
      ...(options.meta || {}),
    },
  };

  return NextResponse.json(payload, {
    status: options.status ?? 200,
    headers,
  });
}

/**
 * Formats an error into a standard JSON error response.
 */
export function errorResponse(
  err: unknown,
  requestId = resolveRequestId(),
  headersInit?: HeadersInit
): NextResponse<ApiErrorResponse> {
  const headers = new Headers(headersInit);
  headers.set(REQUEST_ID_HEADER, requestId);

  let statusCode = 500;
  let code = "INTERNAL_SERVER_ERROR";
  let message = "An unexpected internal error occurred";
  let details: unknown = undefined;

  if (isAppError(err)) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    code = "BAD_REQUEST";
    message = "Input validation failed";
    details = err.flatten();
  } else if (err instanceof Error) {
    if (process.env.NODE_ENV !== "production") {
      message = err.message;
    }
  }

  // Log error with safe redaction
  if (statusCode >= 500) {
    logger.error(`API Error [${code}]: ${message}`, err, { statusCode, code }, requestId);
  } else {
    logger.warn(`Client Request Rejected [${code}]: ${message}`, { statusCode, code, details }, requestId);
  }

  const payload: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
      requestId,
    },
  };

  return NextResponse.json(payload, {
    status: statusCode,
    headers,
  });
}

/**
 * Wraps route handlers with request ID extraction, structured error handling, and uniform responses.
 */
export function createApiHandler<TArgs extends unknown[]>(
  handler: (req: Request, ...args: TArgs) => Promise<Response>
) {
  return async (req: Request, ...args: TArgs): Promise<Response> => {
    const requestId = resolveRequestId(req.headers);
    try {
      const response = await handler(req, ...args);
      // Ensure the x-request-id header is preserved
      if (!response.headers.has(REQUEST_ID_HEADER)) {
        response.headers.set(REQUEST_ID_HEADER, requestId);
      }
      return response;
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

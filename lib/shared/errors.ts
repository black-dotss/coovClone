/**
 * CookMyCv Standard Error Hierarchy
 * All operational errors thrown across service layers should inherit from AppError.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE_ENTITY"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "PAYMENT_REQUIRED"
  | "DEVICE_RESTRICTED"
  | "VERIFICATION_FAILED"
  | "INTERNAL_SERVER_ERROR";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code: ErrorCode = "INTERNAL_SERVER_ERROR",
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    // Restore prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined && { details: this.details }),
    };
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super(message, 400, "BAD_REQUEST", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", details?: unknown) {
    super(message, 401, "UNAUTHORIZED", details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied", details?: unknown) {
    super(message, 403, "FORBIDDEN", details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", details?: unknown) {
    super(message, 404, "NOT_FOUND", details);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict", details?: unknown) {
    super(message, 409, "CONFLICT", details);
  }
}

export class UnprocessableError extends AppError {
  constructor(message = "Unprocessable entity", details?: unknown) {
    super(message, 422, "UNPROCESSABLE_ENTITY", details);
  }
}

export class QuotaExceededError extends AppError {
  constructor(message = "Evaluation quota exceeded", details?: unknown) {
    super(message, 429, "QUOTA_EXCEEDED", details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Rate limit exceeded", retryAfterSeconds?: number) {
    super(message, 429, "RATE_LIMITED", { retryAfterSeconds });
  }
}

export class DeviceRestrictedError extends AppError {
  constructor(
    message = "This device is already registered to another account",
    details?: unknown
  ) {
    super(message, 403, "DEVICE_RESTRICTED", details);
  }
}

export class InternalServerError extends AppError {
  constructor(message = "An unexpected error occurred", details?: unknown) {
    super(message, 500, "INTERNAL_SERVER_ERROR", details);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

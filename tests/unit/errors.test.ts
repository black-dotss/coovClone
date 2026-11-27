import { describe, it, expect } from "vitest";
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  QuotaExceededError,
  DeviceRestrictedError,
  isAppError,
} from "@/lib/shared/errors";

describe("Shared Error Classes", () => {
  it("creates BadRequestError with status 400 and BAD_REQUEST code", () => {
    const error = new BadRequestError("Invalid payload", { field: "email" });
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toBe("Invalid payload");
    expect(error.details).toEqual({ field: "email" });
    expect(error.isOperational).toBe(true);
    expect(isAppError(error)).toBe(true);
  });

  it("creates UnauthorizedError and ForbiddenError with expected status codes", () => {
    const unauth = new UnauthorizedError();
    expect(unauth.statusCode).toBe(401);
    expect(unauth.code).toBe("UNAUTHORIZED");

    const forbidden = new ForbiddenError();
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.code).toBe("FORBIDDEN");

    const notFound = new NotFoundError();
    expect(notFound.statusCode).toBe(404);
    expect(notFound.code).toBe("NOT_FOUND");

    const appErr = new AppError("Base error", 500, "INTERNAL_SERVER_ERROR");
    expect(appErr.statusCode).toBe(500);

    const quota = new QuotaExceededError();
    expect(quota.statusCode).toBe(429);
    expect(quota.code).toBe("QUOTA_EXCEEDED");
  });

  it("creates DeviceRestrictedError with status 403", () => {
    const error = new DeviceRestrictedError();
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe("DEVICE_RESTRICTED");
  });

  it("correctly identifies non-AppError instances", () => {
    expect(isAppError(new Error("Standard error"))).toBe(false);
    expect(isAppError("string error")).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

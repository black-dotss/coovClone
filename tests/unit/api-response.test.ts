import { describe, it, expect } from "vitest";
import { successResponse, errorResponse } from "@/lib/shared/api-response";
import { NotFoundError } from "@/lib/shared/errors";
import { REQUEST_ID_HEADER } from "@/lib/shared/request-id";
import { z } from "zod";

describe("API Response Utilities", () => {
  it("formats standard success response with metadata and headers", async () => {
    const res = successResponse({ name: "CookMyCv" }, { requestId: "req-custom-123" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("req-custom-123");
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ name: "CookMyCv" });
    expect(json.meta?.requestId).toBe("req-custom-123");
    expect(json.meta?.timestamp).toBeDefined();
  });

  it("formats AppError into structured error response with correct status code", async () => {
    const err = new NotFoundError("Evaluation report not found");
    const res = errorResponse(err, "req-404");
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("req-404");
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND");
    expect(json.error.message).toBe("Evaluation report not found");
    expect(json.error.requestId).toBe("req-404");
  });

  it("formats Zod validation error as 400 with details", async () => {
    const schema = z.object({ age: z.number().min(18) });
    const parseResult = schema.safeParse({ age: 15 });

    if (!parseResult.success) {
      const res = errorResponse(parseResult.error, "req-validation");
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("BAD_REQUEST");
      expect(json.error.details).toBeDefined();
    }
  });
});

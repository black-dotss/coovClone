import { describe, it, expect, vi } from "vitest";
import { ForbiddenError } from "@/lib/shared/errors";
import { ZodError } from "zod";

const mockJd = {
  id: "jd-123",
  userId: "user-owner",
  title: "Backend Engineer",
  company: "Stripe",
  rawText: "A comprehensive job description that has more than 50 characters for valid input checks.",
  normalizedRequirements: {
    requirements: [],
    summary: { requiredCount: 0, preferredCount: 0, categoryCounts: {} },
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => [mockJd],
        orderBy: () => [mockJd],
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => [mockJd],
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
  },
  jobDescriptions: {},
}));

import {
  createJobDescription,
  getJobDescriptionById,
  deleteJobDescription,
} from "@/lib/job-descriptions/service";

describe("Job Description Service and Validation", () => {
  it("rejects input with fewer than 50 characters", async () => {
    await expect(
      createJobDescription("user-1", {
        rawText: "Too short",
      })
    ).rejects.toThrowError(ZodError);
  });

  it("retrieves job description when caller is owner", async () => {
    const jd = await getJobDescriptionById("jd-123", "user-owner");
    expect(jd.id).toBe("jd-123");
    expect(jd.userId).toBe("user-owner");
  });

  it("denies access with ForbiddenError when caller is not the owner", async () => {
    await expect(
      getJobDescriptionById("jd-123", "unauthorized-intruder")
    ).rejects.toThrowError(ForbiddenError);
  });

  it("prevents deletion with ForbiddenError when caller is not the owner", async () => {
    await expect(
      deleteJobDescription("jd-123", "unauthorized-intruder")
    ).rejects.toThrowError(ForbiddenError);
  });
});

import { db, jobDescriptions } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { createJobDescriptionSchema, type CreateJobDescriptionInput } from "./validation";
import { extractAndNormalizeRequirements } from "./extractor";
import { matchRequirementsAgainstCv } from "./matcher";
import { assertOwnership } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import type { JobDescriptionRecord, AtsMatchReport, NormalizedRequirements } from "./types";

export async function createJobDescription(
  userId: string,
  input: CreateJobDescriptionInput
): Promise<JobDescriptionRecord> {
  const parsed = createJobDescriptionSchema.parse(input);

  // Extract structured requirements
  const normalized = extractAndNormalizeRequirements(parsed.rawText);
  if (parsed.title) normalized.title = parsed.title;
  if (parsed.company) normalized.company = parsed.company;

  const [record] = await db
    .insert(jobDescriptions)
    .values({
      userId,
      title: parsed.title || null,
      company: parsed.company || null,
      rawText: parsed.rawText,
      normalizedRequirements: normalized as unknown as Record<string, unknown>,
    })
    .returning();

  logger.info("Created job description record", {
    jdId: record.id,
    userId,
    requirementsCount: normalized.requirements.length,
  });

  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    company: record.company,
    rawText: record.rawText,
    normalizedRequirements: record.normalizedRequirements as unknown as NormalizedRequirements,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function getJobDescriptionById(
  id: string,
  requestingUserId: string
): Promise<JobDescriptionRecord> {
  const [record] = await db
    .select()
    .from(jobDescriptions)
    .where(eq(jobDescriptions.id, id));

  if (!record) {
    throw new NotFoundError("Job description not found");
  }

  assertOwnership(record.userId, requestingUserId, "job description");

  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    company: record.company,
    rawText: record.rawText,
    normalizedRequirements: record.normalizedRequirements as unknown as NormalizedRequirements,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function listUserJobDescriptions(userId: string): Promise<JobDescriptionRecord[]> {
  const records = await db
    .select()
    .from(jobDescriptions)
    .where(eq(jobDescriptions.userId, userId))
    .orderBy(desc(jobDescriptions.createdAt));

  return records.map((r) => ({
    id: r.id,
    userId: r.userId,
    title: r.title,
    company: r.company,
    rawText: r.rawText,
    normalizedRequirements: r.normalizedRequirements as unknown as NormalizedRequirements,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function deleteJobDescription(
  id: string,
  requestingUserId: string
): Promise<{ success: boolean; id: string }> {
  await getJobDescriptionById(id, requestingUserId);

  await db.delete(jobDescriptions).where(eq(jobDescriptions.id, id));
  logger.info("Deleted job description record", { jdId: id, userId: requestingUserId });

  return { success: true, id };
}

export async function matchJobDescriptionWithCv(params: {
  jobDescriptionId: string;
  cvText: string;
  requestingUserId: string;
}): Promise<AtsMatchReport> {
  const jd = await getJobDescriptionById(params.jobDescriptionId, params.requestingUserId);
  return matchRequirementsAgainstCv(jd.normalizedRequirements, params.cvText, jd.id);
}

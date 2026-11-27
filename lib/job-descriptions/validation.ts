import { z } from "zod";

export const MIN_JD_LENGTH = 50;
export const MAX_JD_LENGTH = 50_000;

export const createJobDescriptionSchema = z.object({
  rawText: z
    .string()
    .min(
      MIN_JD_LENGTH,
      `Job description must be at least ${MIN_JD_LENGTH} characters long to perform meaningful extraction.`
    )
    .max(
      MAX_JD_LENGTH,
      `Job description exceeds the maximum length of ${MAX_JD_LENGTH.toLocaleString()} characters.`
    ),
  title: z
    .string()
    .max(150, "Job title cannot exceed 150 characters")
    .optional()
    .nullable(),
  company: z
    .string()
    .max(150, "Company name cannot exceed 150 characters")
    .optional()
    .nullable(),
});

export const matchCvAgainstJdSchema = z.object({
  cvText: z
    .string()
    .min(20, "CV text is too short for ATS evaluation (minimum 20 characters)"),
  jobDescriptionId: z.string().uuid().optional(),
  rawJdText: z.string().min(MIN_JD_LENGTH).optional(),
});

export type CreateJobDescriptionInput = z.infer<typeof createJobDescriptionSchema>;
export type MatchCvAgainstJdInput = z.infer<typeof matchCvAgainstJdSchema>;

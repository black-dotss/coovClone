import { z } from "zod";

export const GenerateRewritesInputSchema = z.object({
  customBullets: z.array(z.string().min(5).max(500)).max(10).optional(),
});

export const ToggleRewriteSchema = z.object({
  isAccepted: z.boolean(),
});

export const DefenseSubmissionSchema = z.object({
  claimOrFlag: z.string().min(3, "Claim or criticism reference must be at least 3 characters").max(300),
  defenseText: z.string().min(10, "Defense explanation must be at least 10 characters").max(2000),
  supportingEvidence: z.string().max(1000).optional(),
});

export const MultiJdComparisonSchema = z.object({
  cvVersionId: z.string().uuid("Invalid CV version ID"),
  jobDescriptionIds: z
    .array(z.string().uuid("Invalid Job Description ID"))
    .min(2, "Must provide at least 2 job descriptions to compare")
    .max(3, "Cannot compare more than 3 job descriptions at once"),
});

import { z } from "zod";

export const CreateEvaluationInputSchema = z.object({
  cvVersionId: z.string().uuid("Invalid CV version ID"),
  jobDescriptionId: z.string().uuid("Invalid job description ID"),
  tone: z.enum(["friendly", "strict", "brutal_roast"]).default("strict"),
  walletAddress: z.string().min(32).max(64).optional(),
  stakeTxSignature: z.string().min(32).max(128).optional(),
  referrerWallet: z.string().min(32).max(64).optional(),
});

export type CreateEvaluationSchemaInput = z.infer<typeof CreateEvaluationInputSchema>;

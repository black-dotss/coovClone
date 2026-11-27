import { z } from "zod";
import { AGENT_ROLES } from "./types";

export const AgentRoleSchema = z.enum(AGENT_ROLES);

export const EvaluationToneSchema = z.enum(["friendly", "strict", "brutal_roast"]);

export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);

export const AgentFindingSchema = z
  .object({
    claim: z.string().min(5, "Claim must be descriptive (at least 5 characters)"),
    evidenceSnippet: z
      .string()
      .min(3, "Evidence snippet from CV or JD must be provided to ground claims"),
    sourceReference: z
      .string()
      .min(2, "Source reference must indicate section or page"),
    severity: SeveritySchema,
    confidence: z.number().min(0).max(1),
    isUncertain: z.boolean().default(false),
    uncertaintyReason: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.isUncertain && (!data.uncertaintyReason || data.uncertaintyReason.trim() === "")) {
        return false;
      }
      return true;
    },
    {
      message: "An uncertainty reason must be provided when marked as uncertain",
      path: ["uncertaintyReason"],
    }
  );

export const AgentOutputSchema = z.object({
  agentRole: AgentRoleSchema,
  displayName: z.string().min(2),
  position: z.string().min(10, "Agent position stance must be at least 10 characters"),
  scoreContribution: z.number().min(0).max(100),
  findings: z.array(AgentFindingSchema).min(1, "Agent must produce at least one grounded finding"),
  missingInformation: z.array(z.string()).default([]),
  questionsForDebate: z.array(z.string()).default([]),
  tone: EvaluationToneSchema,
  voiceCommentary: z.string().min(5, "Voice commentary must be provided"),
});

export const AgentInputSchema = z.object({
  agentRole: AgentRoleSchema,
  cvText: z.string().min(20, "CV text must be at least 20 characters"),
  jdText: z.string().min(20, "Job description must be at least 20 characters"),
  tone: EvaluationToneSchema.default("strict"),
  normalizedRequirements: z.record(z.string(), z.unknown()).optional(),
});

export const DebateTurnSchema = z.object({
  sequence: z.number().int().min(1),
  agentRole: AgentRoleSchema,
  replyToRole: AgentRoleSchema.optional(),
  content: z.string().min(10, "Debate turn must be at least 10 characters"),
  evidenceReferences: z.array(z.string()).default([]),
});

export const PrioritizedFixSchema = z.object({
  fix: z.string().min(10),
  expectedBenefit: z.string().min(5),
  effort: z.enum(["low", "medium", "high"]),
});

export const RedFlagNoteSchema = z.object({
  flag: z.string().min(5),
  evidenceSnippet: z.string().min(3),
  isProofOfProblem: z.literal(false),
});

export const InterviewQuestionItemSchema = z.object({
  question: z.string().min(10),
  tiedToClaim: z.string().min(5),
  rationale: z.string().min(10),
});

export const SynthesisReportSchema = z.object({
  overallScore: z.number().min(0).max(100),
  verdict: z.enum(["Strong fit", "Potential fit", "Significant gaps", "Weak fit"]),
  confidence: z.number().min(0).max(1),
  dimensions: z.object({
    roleFit: z.number().min(0).max(100),
    skillsAndEvidence: z.number().min(0).max(100),
    atsAlignment: z.number().min(0).max(100),
    impactAndClarity: z.number().min(0).max(100),
    professionalPresentation: z.number().min(0).max(100),
  }),
  explanation: z.string().min(20),
  strengths: z.array(z.string()).min(1),
  weaknesses: z.array(z.string()).min(1),
  prioritizedFixes: z.array(PrioritizedFixSchema).min(1).max(5),
  redFlags: z.array(RedFlagNoteSchema),
  likelyInterviewQuestions: z.array(InterviewQuestionItemSchema).min(1),
  atsSummary: z.object({
    keywordCoverage: z.number().min(0).max(100),
    matched: z.array(z.string()),
    partial: z.array(z.string()),
    missing: z.array(z.string()),
    disclaimer: z.string(),
  }),
  uncertaintyNotes: z.array(z.string()).default([]),
});

export type AgentOutputValidated = z.infer<typeof AgentOutputSchema>;
export type AgentFindingValidated = z.infer<typeof AgentFindingSchema>;
export type SynthesisReportValidated = z.infer<typeof SynthesisReportSchema>;

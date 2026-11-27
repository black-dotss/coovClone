import { z } from "zod";

export const StartInterviewSchema = z.object({
  evaluationId: z.string().uuid("Invalid Evaluation ID"),
});

export const SubmitAnswerSchema = z.object({
  questionId: z.string().min(1, "Question ID is required"),
  questionText: z.string().min(5, "Question text is required"),
  userAnswer: z
    .string()
    .min(10, "Your answer must be at least 10 characters long")
    .max(5000, "Answer cannot exceed 5000 characters"),
});

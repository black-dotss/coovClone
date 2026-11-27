import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, BadRequestError } from "@/lib/shared/errors";
import { interviewSessions, interviewAnswers, evaluations, reports } from "@/lib/db/schema";
import {
  startInterviewSession,
  getInterviewSession,
  submitInterviewAnswer,
  completeInterviewSession,
  evaluateAnswerRubric,
} from "@/lib/interviews/service";

const mockEvaluation = {
  id: "eval-interview-test-1",
  ownerUserId: "user-owner-1",
  status: "completed",
};

const mockReport = {
  structuredReport: {
    likelyInterviewQuestions: [
      {
        question: "How did you design the microservices architecture mentioned in your CV?",
        tiedToClaim: "Senior Backend Engineer",
        rationale: "Tests system design depth",
      },
      {
        question: "Can you describe a time a critical database migration failed and how you recovered?",
        tiedToClaim: "PostgreSQL Database APIs",
        rationale: "Tests production incident response",
      },
    ],
  },
};

let inMemorySessions: Record<string, unknown>[] = [];
let inMemoryAnswers: Record<string, unknown>[] = [];

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => Promise.resolve(data.slice(0, n)),
    orderBy: () => createMockQuery(data),
    where: () => createMockQuery(data),
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table === evaluations) return createMockQuery([mockEvaluation]);
        if (table === reports) return createMockQuery([mockReport]);
        if (table === interviewSessions) return createMockQuery(inMemorySessions);
        if (table === interviewAnswers) return createMockQuery(inMemoryAnswers);
        return createMockQuery([]);
      },
    }),
    insert: (table: unknown) => ({
      values: (val: Record<string, unknown>) => {
        const record = { id: `id-${Date.now()}`, ...val, createdAt: new Date(), updatedAt: new Date() };
        if (table === interviewSessions) {
          inMemorySessions.push(record);
        }
        if (table === interviewAnswers) {
          inMemoryAnswers.push(record);
        }
        return {
          returning: () => [record],
        };
      },
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          if (inMemorySessions.length > 0) {
            Object.assign(inMemorySessions[0], updates);
          }
          return Promise.resolve();
        },
      }),
    }),
  },
}));

describe("Mock Interview Sessions and Rubric Feedback", () => {
  beforeEach(() => {
    inMemorySessions = [];
    inMemoryAnswers = [];
    vi.clearAllMocks();
  });

  describe("Objective Rubric Evaluation", () => {
    it("evaluates a well-structured STAR answer with high relevance and depth", () => {
      const question = "How did you design the microservices architecture?";
      const answer =
        "At my previous company, our monolith was experiencing severe deployment bottlenecks. I led the architectural transition by decoupling the authentication and billing modules into standalone Go microservices. I implemented gRPC for internal RPC and configured Kafka event streaming, which improved deployment frequency by 3x and reduced latency.";

      const { rubricScores, feedback, improvementTip } = evaluateAnswerRubric(question, answer);

      expect(rubricScores.relevance).toBeGreaterThanOrEqual(7);
      expect(rubricScores.depth).toBeGreaterThanOrEqual(7);
      expect(rubricScores.structure).toBeGreaterThanOrEqual(7);
      expect(rubricScores.overall).toBeGreaterThanOrEqual(7.5);
      expect(feedback).toContain("Excellent answer");
      expect(improvementTip).toBeDefined();
    });

    it("rejects overly short answers under 5 words with BadRequestError", () => {
      expect(() => evaluateAnswerRubric("Tell me about yourself", "I am good.")).toThrow(
        BadRequestError
      );
    });
  });

  describe("Session Lifecycle & Ownership", () => {
    it("starts an interview session, loading questions from the evaluation report", async () => {
      const session = await startInterviewSession("eval-interview-test-1", "user-owner-1");

      expect(session.status).toBe("in_progress");
      expect(session.questions).toHaveLength(2);
      expect(session.nextQuestion?.question).toContain("microservices architecture");
      expect(session.answers).toHaveLength(0);
    });

    it("rejects non-owner when starting an interview", async () => {
      await expect(
        startInterviewSession("eval-interview-test-1", "attacker-999")
      ).rejects.toThrow(ForbiddenError);
    });

    it("submits answer, records rubric feedback, and tracks next question", async () => {
      const session = await startInterviewSession("eval-interview-test-1", "user-owner-1");

      const feedback = await submitInterviewAnswer(session.id, "user-owner-1", {
        questionId: "q-1",
        questionText: session.questions[0].question,
        userAnswer:
          "I architected the microservices using TypeScript and Docker, establishing clean domain boundaries and automated integration tests which resulted in zero downtime releases.",
      });

      expect(feedback.score).toBeGreaterThan(0);
      expect(feedback.rubricScores.structure).toBeDefined();

      // Retrieve session to inspect progress
      const current = await getInterviewSession(session.id, "user-owner-1");
      expect(current.answers).toHaveLength(1);
      expect(current.nextQuestion?.id).toBe("q-2");
    });

    it("prohibits submitting answers to a completed session", async () => {
      const session = await startInterviewSession("eval-interview-test-1", "user-owner-1");
      await completeInterviewSession(session.id, "user-owner-1");

      await expect(
        submitInterviewAnswer(session.id, "user-owner-1", {
          questionId: "q-1",
          questionText: "Question 1",
          userAnswer: "Valid answer with plenty of words to pass length checks.",
        })
      ).rejects.toThrow(BadRequestError);
    });
  });
});

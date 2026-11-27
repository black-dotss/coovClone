export interface InterviewQuestion {
  id: string;
  question: string;
  targetCompetency: string;
  expectedKeyPoints: string[];
  tiedToClaim?: string;
  rationale?: string;
}

export interface RubricScores {
  relevance: number; // 0 - 10
  depth: number;     // 0 - 10
  structure: number; // 0 - 10
  honestyAndSelfAwareness: number; // 0 - 10
  overall: number;   // 0 - 10
}

export interface InterviewAnswerFeedback {
  answerId: string;
  questionId: string;
  score: number;
  rubricScores: RubricScores;
  feedback: string;
  improvementTip: string;
}

export interface InterviewAnswerRecord {
  id: string;
  sessionId: string;
  questionId: string;
  questionText: string;
  userAnswer: string;
  rubricScores: RubricScores;
  feedback: string;
  improvementTip: string;
  createdAt: Date;
}

export interface InterviewSession {
  id: string;
  userId: string;
  evaluationId: string;
  status: "in_progress" | "completed";
  questions: InterviewQuestion[];
  createdAt: Date;
  updatedAt: Date;
}

export interface InterviewSessionDetail extends InterviewSession {
  answers: InterviewAnswerRecord[];
  nextQuestion: InterviewQuestion | null;
  overallPerformanceScore?: number | null;
  summaryFeedback?: string | null;
}

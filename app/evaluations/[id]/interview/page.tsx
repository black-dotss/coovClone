"use client";

import React, { useState, use } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import { AppShell } from "@/components/layout/app-shell";
import type {
  InterviewSessionDetail,
  InterviewAnswerFeedback,
  InterviewAnswerRecord,
} from "@/lib/interviews/types";

export default function MockInterviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [session, setSession] = useState<InterviewSessionDetail | null>(null);
  const [starting, setStarting] = useState(false);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState("");
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [feedbackMap, setFeedbackMap] = useState<
    Record<string, InterviewAnswerFeedback | InterviewAnswerRecord>
  >({});
  const [isCompleted, setIsCompleted] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartSession = async () => {
    setStarting(true);
    setError(null);
    try {
      const data = await apiFetch<InterviewSessionDetail>("/api/interviews", {
        method: "POST",
        body: JSON.stringify({ evaluationId: id }),
      });
      setSession(data);
      setActiveQuestionIndex(0);
      setUserAnswer("");
      setFeedbackMap({});
      setIsCompleted(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to start interview session";
      setError(message);
    } finally {
      setStarting(false);
    }
  };

  const currentQuestion = session?.questions[activeQuestionIndex];
  const currentFeedback = currentQuestion
    ? feedbackMap[currentQuestion.id]
    : null;

  const handleSubmitAnswer = async () => {
    if (!session || !currentQuestion) return;
    if (userAnswer.trim().length < 10) {
      setError("Please write an answer of at least 10 characters.");
      return;
    }

    setSubmittingAnswer(true);
    setError(null);
    try {
      const feedback = await apiFetch<InterviewAnswerFeedback>(
        `/api/interviews/${session.id}/answer`,
        {
          method: "POST",
          body: JSON.stringify({
            questionId: currentQuestion.id,
            questionText: currentQuestion.question,
            userAnswer: userAnswer.trim(),
          }),
        }
      );

      setFeedbackMap((prev) => ({
        ...prev,
        [currentQuestion.id]: feedback,
      }));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to submit interview answer";
      setError(message);
    } finally {
      setSubmittingAnswer(false);
    }
  };

  const handleCompleteInterview = async () => {
    if (!session) return;
    setCompleting(true);
    setError(null);
    try {
      await apiFetch<InterviewSessionDetail>(
        `/api/interviews/${session.id}/complete`,
        { method: "POST" }
      );
      setIsCompleted(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to complete interview";
      setError(message);
    } finally {
      setCompleting(false);
    }
  };

  const handleNextQuestion = () => {
    if (!session) return;
    if (activeQuestionIndex < session.questions.length - 1) {
      setActiveQuestionIndex((prev) => prev + 1);
      setUserAnswer("");
      setError(null);
    }
  };

  const handlePrevQuestion = () => {
    if (activeQuestionIndex > 0) {
      setActiveQuestionIndex((prev) => prev - 1);
      setUserAnswer("");
      setError(null);
    }
  };

  const answeredCount = session
    ? session.questions.filter((q) => feedbackMap[q.id]).length
    : 0;

  return (
    <AppShell
      title="Interactive Mock Interview Room"
      description="Simulate a rigorous panel interview with tailored questions based on your CV claims. Receive question-by-question rubric evaluations and STAR method coaching."
      action={
        <Link href={`/evaluations/${id}/report`}>
          <Button variant="outline" size="sm" className="text-xs">
            ← Back to Report
          </Button>
        </Link>
      }
    >
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-xs font-medium text-text-muted">
          <Link href="/profile" className="hover:text-text transition-colors">
            Profile
          </Link>
          <span>/</span>
          <Link href={`/evaluations/${id}/report`} className="hover:text-text transition-colors">
            Report ({id.slice(0, 8)})
          </Link>
          <span>/</span>
          <span className="text-text font-semibold">Mock Interview</span>
        </div>

        {error && (
          <Alert
            variant="danger"
            title="Interview Notice"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartSession}
                className="text-xs"
              >
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {!session ? (
          <Card className="text-center py-16 bg-surface border-border">
            <CardContent className="space-y-5">
              <div className="w-14 h-14 rounded-xl bg-surface-elevated border border-border flex items-center justify-center mx-auto text-text-muted">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-text">Ready for your interview simulation?</h2>
                <p className="text-xs sm:text-sm text-text-secondary max-w-md mx-auto mt-1 leading-relaxed">
                  Our committee generates high-probability behavioral and technical questions based on your CV&apos;s
                  claims, accomplishments, and detected gaps.
                </p>
              </div>
              <Button
                variant="primary"
                size="md"
                onClick={handleStartSession}
                isLoading={starting}
                className="font-semibold text-xs sm:text-sm"
              >
                Start Practice Session
              </Button>
            </CardContent>
          </Card>
        ) : isCompleted ? (
          /* Completed Summary View */
          <Card className="border-border bg-surface shadow-xs">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <CardTitle className="text-base font-bold text-text">
                    Interview Session Completed
                  </CardTitle>
                </div>
                <Badge variant="purple">Completed</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">
              <p className="text-xs sm:text-sm text-text-secondary">
                Interview completed. You submitted answers for <strong className="text-text">{answeredCount} of {session.questions.length}</strong> questions.
              </p>

              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted font-mono">
                  Questions Answered & Feedback
                </h3>
                {session.questions.map((q, idx) => {
                  const fb = feedbackMap[q.id];
                  return (
                    <div
                      key={q.id}
                      className="p-4 rounded-lg bg-surface-elevated border border-border space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-text">
                          Question {idx + 1}: {q.targetCompetency}
                        </span>
                        {fb ? (
                          <span className="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
                            Score: {fb.rubricScores.overall}/10
                          </span>
                        ) : (
                          <Badge variant="neutral">Skipped</Badge>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-text font-medium">&ldquo;{q.question}&rdquo;</p>
                      {fb && (
                        <p className="text-xs text-text-secondary leading-relaxed">
                          <strong className="text-text font-semibold">Feedback:</strong> {fb.feedback}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-4 flex flex-col sm:flex-row justify-between items-center gap-3 border-t border-border">
                <Link href={`/evaluations/${id}/report`} className="w-full sm:w-auto">
                  <Button variant="outline" size="sm" className="w-full sm:w-auto text-xs">
                    ← Back to Report
                  </Button>
                </Link>
                <Button variant="primary" size="sm" onClick={handleStartSession} className="w-full sm:w-auto text-xs font-semibold">
                  Start Another Session
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          /* Active Interview Flow */
          <div className="space-y-6">
            {/* Progress Header */}
            <div className="flex items-center justify-between text-xs text-text-muted font-mono">
              <span>
                Question {activeQuestionIndex + 1} of {session.questions.length}
              </span>
              <span>
                {answeredCount} of {session.questions.length} Answered
              </span>
            </div>
            <ProgressBar
              value={((activeQuestionIndex + 1) / session.questions.length) * 100}
              color="purple"
              size="sm"
            />

            {/* Question Stepper Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Interview questions">
              {session.questions.map((q, idx) => (
                <button
                  key={q.id}
                  onClick={() => {
                    setActiveQuestionIndex(idx);
                    setUserAnswer("");
                    setError(null);
                  }}
                  role="tab"
                  aria-selected={activeQuestionIndex === idx}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium border transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeQuestionIndex === idx
                      ? "bg-text text-surface border-text font-bold shadow-xs"
                      : feedbackMap[q.id]
                      ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
                      : "bg-surface text-text-muted border-border hover:text-text hover:border-text-muted"
                  }`}
                >
                  <span>Q{idx + 1}</span>
                  {feedbackMap[q.id] && (
                    <svg className="w-3 h-3 text-purple-600 dark:text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>

            {currentQuestion && (
              <Card className="bg-surface border-border">
                <CardHeader className="border-b border-border pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="neutral">{currentQuestion.targetCompetency}</Badge>
                    {currentFeedback && (
                      <span className="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
                        Score: {currentFeedback.rubricScores.overall}/10
                      </span>
                    )}
                  </div>
                  <CardTitle className="text-base sm:text-lg font-bold mt-2 text-text">
                    &ldquo;{currentQuestion.question}&rdquo;
                  </CardTitle>
                  {currentQuestion.tiedToClaim && (
                    <p className="text-xs text-text-muted italic mt-1">
                      Derived from CV claim: &ldquo;{currentQuestion.tiedToClaim}&rdquo;
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-6 pt-4">
                  {/* What the recruiter looks for */}
                  {currentQuestion.expectedKeyPoints && (
                    <div className="p-3.5 rounded-lg bg-surface-elevated border border-border space-y-1.5 text-xs text-text-secondary">
                      <span className="font-semibold text-text uppercase tracking-wider text-[10px] font-mono block">
                        Evaluation Criteria:
                      </span>
                      <ul className="list-disc list-inside space-y-0.5 leading-relaxed">
                        {currentQuestion.expectedKeyPoints.map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Rubric Feedback Card (If already answered) */}
                  {currentFeedback ? (
                    <div className="space-y-4 pt-2">
                      <div className="p-4 rounded-lg bg-surface-elevated border border-purple-500/30 space-y-4">
                        <div className="flex items-center justify-between border-b border-border pb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 font-mono">
                            Rubric Evaluation Breakdown
                          </span>
                          <Badge variant="success" size="sm">
                            Overall: {currentFeedback.rubricScores.overall}/10
                          </Badge>
                        </div>

                        {/* 4 Rubric Dimensions */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                          <div className="p-2.5 rounded-lg bg-surface border border-border">
                            <span className="text-[10px] text-text-muted block">Relevance</span>
                            <span className="font-mono font-bold text-xs sm:text-sm text-text">
                              {currentFeedback.rubricScores.relevance}/10
                            </span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-surface border border-border">
                            <span className="text-[10px] text-text-muted block">Depth</span>
                            <span className="font-mono font-bold text-xs sm:text-sm text-text">
                              {currentFeedback.rubricScores.depth}/10
                            </span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-surface border border-border">
                            <span className="text-[10px] text-text-muted block">Structure (STAR)</span>
                            <span className="font-mono font-bold text-xs sm:text-sm text-text">
                              {currentFeedback.rubricScores.structure}/10
                            </span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-surface border border-border">
                            <span className="text-[10px] text-text-muted block">Honesty</span>
                            <span className="font-mono font-bold text-xs sm:text-sm text-text">
                              {currentFeedback.rubricScores.honestyAndSelfAwareness}/10
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2 text-xs">
                          <p className="text-text-secondary leading-relaxed">
                            <strong className="text-text font-semibold">Feedback:</strong> {currentFeedback.feedback}
                          </p>
                          <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 leading-relaxed">
                            <strong className="font-semibold">Improvement Tip:</strong> {currentFeedback.improvementTip}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setFeedbackMap((prev) => {
                              const next = { ...prev };
                              delete next[currentQuestion.id];
                              return next;
                            });
                          }}
                          className="w-full sm:w-auto text-xs"
                        >
                          Try Answering Again
                        </Button>
                        {activeQuestionIndex < session.questions.length - 1 ? (
                          <Button variant="primary" size="sm" onClick={handleNextQuestion} className="w-full sm:w-auto text-xs font-semibold">
                            Next Question →
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleCompleteInterview}
                            isLoading={completing}
                            className="w-full sm:w-auto text-xs font-semibold"
                          >
                            Complete Interview
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Answer Input Form */
                    <div className="space-y-4">
                      <div>
                        <Textarea
                          label="Your Verbal Answer (Practice STAR method: Situation, Task, Action, Result)"
                          placeholder="In my previous role at... when faced with... I implemented... which resulted in..."
                          value={userAnswer}
                          onChange={(e) => setUserAnswer(e.target.value)}
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && userAnswer.trim().length >= 10 && !submittingAnswer) {
                              e.preventDefault();
                              handleSubmitAnswer();
                            }
                          }}
                          rows={6}
                          helperText="Press Cmd+Enter (or Ctrl+Enter) to submit answer"
                        />
                        <span className="text-[11px] font-mono text-text-muted float-right mt-1">
                          {userAnswer.length} characters (min 10)
                        </span>
                      </div>

                      <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={activeQuestionIndex === 0}
                            onClick={handlePrevQuestion}
                            className="text-xs"
                          >
                            ← Previous
                          </Button>
                          {activeQuestionIndex < session.questions.length - 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleNextQuestion}
                              className="text-xs"
                            >
                              Skip →
                            </Button>
                          )}
                        </div>

                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleSubmitAnswer}
                          isLoading={submittingAnswer}
                          disabled={userAnswer.trim().length < 10}
                          className="text-xs font-semibold"
                        >
                          Submit Answer for Scoring
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

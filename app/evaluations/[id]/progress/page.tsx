"use client";

import React, { useEffect, useState, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Avatar, AgentRoleKey, preloadAgentAvatars } from "@/components/ui/avatar";
import { ErrorPopup } from "@/components/ui/error-popup";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";

interface DebateTurn {
  id?: string;
  sequence: number;
  agentRole: AgentRoleKey;
  content: string;
  evidenceReferences?: string[];
}

interface CompletedAgentSummary {
  role: AgentRoleKey;
  displayName: string;
  scoreContribution: number;
  durationMs?: number;
  voiceCommentary?: string;
}

interface EvaluationProgressEvent {
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  overallScore?: number;
  verdict?: string;
  bountyContext?: {
    bountyId: string;
    title: string;
    company: string;
    minScore: number;
    rewardPerWinnerUsdc: number;
    reviewStatus: string | null;
    isEligible: boolean;
  } | null;
  progressPercent?: number;
  progressPercentage?: number;
  currentPhase?: string;
  completedAgents?: CompletedAgentSummary[];
  agentStatuses?: Record<string, string>;
  debateMessages?: DebateTurn[];
  error?: string;
  errorMessage?: string;
}

const COMMITTEE_PERSONAS: Array<{
  role: AgentRoleKey;
  title: string;
  focus: string;
}> = [
  {
    role: "hr_recruiter",
    title: "HR Recruiter",
    focus: "Tenure & trajectory",
  },
  {
    role: "technical_interviewer",
    title: "Tech Interviewer",
    focus: "Architecture & code depth",
  },
  {
    role: "ats_scanner",
    title: "ATS Scanner",
    focus: "Keywords & parsability",
  },
  {
    role: "hiring_manager",
    title: "Hiring Manager",
    focus: "Ownership & execution",
  },
  {
    role: "career_strategist",
    title: "Career Strategist",
    focus: "Seniority & benchmark",
  },
  {
    role: "red_flag_analyst",
    title: "Red Flag Analyst",
    focus: "Risk audit & gaps",
  },
];

export default function LiveDebateProgressPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const evaluationId = params?.id as string;
  const isViewingArchive = searchParams?.get("view") === "chat";

  const [status, setStatus] = useState<EvaluationProgressEvent["status"]>("queued");
  const [_currentPhase, _setCurrentPhase] = useState("Preparing evaluation...");
  const [completedAgents, setCompletedAgents] = useState<CompletedAgentSummary[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({});
  const [debateMessages, setDebateMessages] = useState<DebateTurn[]>([]);
  const [bountyContext, setBountyContext] = useState<EvaluationProgressEvent["bountyContext"]>(null);
  const [error, setError] = useState<string | null>(null);

  const statusRef = useRef<EvaluationProgressEvent["status"]>("queued");
  const eventSourceRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isUserScrolledUp = useRef(false);
  const prevTotalMessagesRef = useRef(0);
  const wasAlreadyCompletedOnMount = useRef<boolean | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  useEffect(() => {
    preloadAgentAvatars();
  }, []);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior,
      });
    }
  };

  const handleChatScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isScrolledUp = distanceFromBottom > 60;
    isUserScrolledUp.current = isScrolledUp;
    setShowScrollBottom(isScrolledUp);
  };

  useEffect(() => {
    if (!evaluationId) return;

    let reconnectTimeout: NodeJS.Timeout | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    let redirectTimeout: NodeJS.Timeout | null = null;

    const handlePayload = (data: EvaluationProgressEvent) => {
      const isInitialMount = wasAlreadyCompletedOnMount.current === null;
      if (isInitialMount) {
        wasAlreadyCompletedOnMount.current = data.status === "completed";
      }
      statusRef.current = data.status;
      setStatus(data.status);
      if (data.currentPhase) _setCurrentPhase(data.currentPhase);
      if (data.bountyContext !== undefined) setBountyContext(data.bountyContext);
      if (data.completedAgents && Array.isArray(data.completedAgents)) {
        setCompletedAgents(data.completedAgents);
      }
      if (data.agentStatuses) {
        setAgentStatuses(data.agentStatuses);
      }
      if (data.debateMessages && Array.isArray(data.debateMessages)) {
        setDebateMessages(data.debateMessages);
      }
      const err = data.error || data.errorMessage;
      if (err) setError(err);

      // Only auto-scroll when a new message has actually arrived AND user has not scrolled up
      const totalMsgs = (data.completedAgents?.length || 0) + (data.debateMessages?.length || 0);
      const hasNewMessage = totalMsgs > prevTotalMessagesRef.current;
      prevTotalMessagesRef.current = totalMsgs;

      if ((isInitialMount || hasNewMessage) && !isUserScrolledUp.current) {
        setTimeout(() => {
          if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
          }
        }, 50);
      }

      if (data.status === "completed" || data.status === "failed") {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
        if (pollInterval) clearInterval(pollInterval);

        // Never redirect if user clicked "Return to Agent Chat" (?view=chat)
        // or if the evaluation was already completed when they navigated to this page
        const isArchive = isViewingArchive || wasAlreadyCompletedOnMount.current === true;
        if (data.status === "completed" && !isArchive && wasAlreadyCompletedOnMount.current === false) {
          redirectTimeout = setTimeout(() => {
            if (data.bountyContext?.bountyId) {
              router.push(
                `/bounties/${encodeURIComponent(data.bountyContext.bountyId)}/result?evalId=${encodeURIComponent(evaluationId)}`
              );
            } else {
              router.push(`/evaluations/${evaluationId}/report`);
            }
          }, 1500);
        }
      }
    };

    function connectSSE() {
      const url = `/api/evaluations/${evaluationId}/progress`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      const onEvent = (event: MessageEvent) => {
        try {
          const data: EvaluationProgressEvent = JSON.parse(event.data);
          handlePayload(data);
        } catch {
          // Ignore parse errors on keepalive ping
        }
      };

      es.onmessage = onEvent;
      es.addEventListener("progress", onEvent);

      es.onerror = () => {
        es.close();
        if (statusRef.current !== "completed" && statusRef.current !== "failed") {
          reconnectTimeout = setTimeout(connectSSE, 2000);
        }
      };
    }

    connectSSE();

    // Ensure evaluation worker is triggered via explicit run endpoint
    const triggerRun = () => {
      apiFetch(`/api/evaluations/${evaluationId}/run`, {
        method: "POST",
      }).catch(() => {
        // Non-blocking trigger attempt
      });
    };

    triggerRun();
    const runRetryTimeout = setTimeout(() => {
      if (statusRef.current === "queued") {
        triggerRun();
      }
    }, 3000);

    // Resilient fallback polling every 2 seconds for instant live updates
    pollInterval = setInterval(async () => {
      try {
        const res = await apiFetch<EvaluationProgressEvent>(
          `/api/evaluations/${evaluationId}/progress`
        );
        if (res && res.status) {
          handlePayload(res);
        }
      } catch {
        // Polling failure is non-fatal
      }
    }, 2000);

    return () => {
      if (runRetryTimeout) clearTimeout(runRetryTimeout);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (redirectTimeout) clearTimeout(redirectTimeout);
      if (pollInterval) clearInterval(pollInterval);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [evaluationId, router, isViewingArchive]);

  const formatRoleTitle = (role: string) => {
    return role
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  const completedRoleSet = new Set<string>(completedAgents.map((a) => a.role));
  const isActiveRun = status === "queued" || status === "processing";
  const responseProgressPct =
    status === "completed"
      ? 100
      : Math.min(
          96,
          Math.max(
            4,
            Math.round(
              (completedAgents.length / 6) * 76 +
                (Math.min(4, debateMessages.length) / 4) * 20
            )
          )
        );

  const activeThinkingAgents = isActiveRun
    ? COMMITTEE_PERSONAS.filter(
        (p) => agentStatuses[p.role] !== "completed" && !completedRoleSet.has(p.role)
      )
    : [];

  const screeningRemarks = completedAgents.filter((a) => a.voiceCommentary);

  const leftPersonas = COMMITTEE_PERSONAS.slice(0, 3);
  const rightPersonas = COMMITTEE_PERSONAS.slice(3, 6);

  const isRightAgent = (role: AgentRoleKey) => {
    return role === "hiring_manager" || role === "career_strategist" || role === "red_flag_analyst";
  };

  const renderAgentCard = (p: (typeof COMMITTEE_PERSONAS)[number]) => {
    const agentStatus = agentStatuses[p.role];
    const isDone = agentStatus === "completed" || completedRoleSet.has(p.role);
    const isTyping = !isDone && isActiveRun;

    return (
      <div
        key={p.role}
        className="p-3.5 bg-surface border border-border rounded-xl flex items-center gap-3.5 transition-all hover:border-purple-500/40 shadow-2xs"
      >
        <Avatar role={p.role} size="2xl" className="shrink-0 rounded-xl shadow-md" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-text truncate" title={p.title}>
            {p.title}
          </div>
          <div className="text-[11px] text-text-muted truncate mt-0.5 font-mono">
            {p.focus}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs font-mono">
            <span className="text-text-muted uppercase text-[9px]">Status:</span>
            {isDone ? (
              <span className="text-purple-400 font-bold">Done</span>
            ) : isTyping ? (
              <span className="text-purple-400 font-bold animate-pulse">Typing...</span>
            ) : (
              <span className="text-text-muted">Standby</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">
            {status === "completed" ? "Review Completed" : "Committee Review in Progress"}
          </h1>
          <p className="text-xs text-text-muted font-mono mt-0.5">
            Session Ref: {evaluationId}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/evaluations"
            className="text-xs text-text-muted hover:text-text underline font-mono"
          >
            ← My Reviews
          </Link>
          {status === "completed" && (
            bountyContext?.bountyId ? (
              <div className="flex items-center gap-2">
                <Link
                  href={`/evaluations/${evaluationId}/report`}
                  className="px-3 py-1.5 border border-border bg-surface hover:bg-surface-elevated text-text text-xs font-semibold rounded-lg transition-colors"
                >
                  View Report
                </Link>
                <Link
                  href={`/bounties/${encodeURIComponent(bountyContext.bountyId)}/result?evalId=${encodeURIComponent(evaluationId)}`}
                  className="inline-flex items-center justify-center px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  View Bounty Result →
                </Link>
              </div>
            ) : (
              <Link
                href={`/evaluations/${evaluationId}/report`}
                className="inline-flex items-center justify-center px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
              >
                View Full Report →
              </Link>
            )
          )}
        </div>
      </div>

      {/* Minimal Step-Filling Progress Bar */}
      <div className="space-y-1.5">
        <div className="w-full h-1.5 rounded-full bg-surface-elevated border border-border overflow-hidden">
          <div
            className="h-full bg-purple-500 transition-all duration-500 ease-out"
            style={{ width: `${responseProgressPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono text-text-muted">
          <span>
            {status === "completed"
              ? "All 6 agents finished"
              : `${completedAgents.length}/6 agents responded`}
          </span>
          <span className="text-purple-400 font-semibold">{responseProgressPct}%</span>
        </div>
      </div>

      <ErrorPopup
        title="Committee Notice"
        message={error}
        onDismiss={() => setError(null)}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.refresh()}
          >
            Retry
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: First 3 Agents */}
        <aside className="lg:col-span-3 space-y-3 order-2 lg:order-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
            {leftPersonas.map(renderAgentCard)}
          </div>
        </aside>

        {/* Center: Committee Chat Feed */}
        <div className="lg:col-span-6 space-y-2.5 order-1 lg:order-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-border">
            <span className="text-sm font-bold text-text font-mono flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              Chat
            </span>
            <span className="text-[11px] text-text-muted font-mono">
              {screeningRemarks.length + debateMessages.length} messages
            </span>
          </div>

          {/* Live Committee Chat Container */}
          <div className="relative border border-border bg-surface rounded-2xl overflow-hidden shadow-xs">
            <div
              ref={chatScrollRef}
              onScroll={handleChatScroll}
              className="h-[580px] overflow-y-auto p-4 sm:p-5 space-y-4 flex flex-col scroll-smooth"
            >

              {/* Initial Screening Remarks (Left vs Right like Telegram) */}
              {screeningRemarks.map((agent) => {
                const isRight = isRightAgent(agent.role);
                return (
                  <div
                    key={`screen-${agent.role}`}
                    className={`flex items-start gap-2.5 max-w-[85%] ${
                      isRight ? "self-end ml-auto flex-row-reverse" : "self-start"
                    }`}
                  >
                    <Avatar role={agent.role} size="md" className="shrink-0 mt-1 rounded-lg" />
                    <div
                      className={`p-3.5 space-y-1.5 shadow-2xs ${
                        isRight
                          ? "bg-purple-100 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800/60 rounded-2xl rounded-tr-xs text-left"
                          : "bg-surface-elevated border border-border rounded-2xl rounded-tl-xs text-left"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={`text-xs font-bold ${isRight ? "text-purple-900 dark:text-purple-200" : "text-text"}`}>
                          {agent.displayName || formatRoleTitle(agent.role)}
                        </span>
                        <span className={`text-[10px] font-mono ${isRight ? "text-purple-700 dark:text-purple-400" : "text-text-muted"}`}>
                          Initial Screening
                        </span>
                      </div>
                      <p className={`text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${isRight ? "text-purple-950 dark:text-zinc-100" : "text-text"}`}>
                        {agent.voiceCommentary}
                      </p>
                    </div>
                  </div>
                );
              })}

              {/* Moderated Debate Exchanges (Left vs Right like Telegram) */}
              {debateMessages.map((turn, index) => {
                const isRight = isRightAgent(turn.agentRole);
                return (
                  <div
                    key={turn.id || index}
                    className={`flex items-start gap-2.5 max-w-[85%] ${
                      isRight ? "self-end ml-auto flex-row-reverse" : "self-start"
                    }`}
                  >
                    <Avatar role={turn.agentRole} size="md" className="shrink-0 mt-1 rounded-lg" />
                    <div
                      className={`p-3.5 space-y-1.5 shadow-2xs ${
                        isRight
                          ? "bg-purple-100 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800/60 rounded-2xl rounded-tr-xs text-left"
                          : "bg-surface-elevated border border-border rounded-2xl rounded-tl-xs text-left"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={`text-xs font-bold ${isRight ? "text-purple-900 dark:text-purple-200" : "text-text"}`}>
                          {formatRoleTitle(turn.agentRole)}
                        </span>
                        <span className={`text-[10px] font-mono ${isRight ? "text-purple-700 dark:text-purple-400" : "text-text-muted"}`}>
                          Debate #{turn.sequence}
                        </span>
                      </div>
                      <p className={`text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${isRight ? "text-purple-950 dark:text-zinc-100" : "text-text"}`}>
                        {turn.content}
                      </p>
                      {turn.evidenceReferences && turn.evidenceReferences.length > 0 && (
                        <div className="mt-2 p-2 bg-black/5 dark:bg-black/40 border-l-2 border-purple-500/70 text-[11px] text-text-secondary font-mono italic">
                          &ldquo;{turn.evidenceReferences.join("; ")}&rdquo;
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Live Typing Bubbles (...) for Every Active Agent */}
              {isActiveRun && (activeThinkingAgents.length > 0 || debateMessages.length < 4) && (
                <div className="space-y-3 pt-1">
                  {(activeThinkingAgents.length > 0
                    ? activeThinkingAgents
                    : COMMITTEE_PERSONAS.slice(0, 2)
                  ).map((agent) => {
                    const isRight = isRightAgent(agent.role);
                    return (
                      <div
                        key={`typing-${agent.role}`}
                        className={`flex items-start gap-2.5 max-w-[85%] ${
                          isRight ? "self-end ml-auto flex-row-reverse" : "self-start"
                        }`}
                      >
                        <Avatar role={agent.role} size="md" className="shrink-0 mt-1 rounded-lg" />
                        <div
                          className={`px-4 py-2.5 rounded-2xl space-y-1 ${
                            isRight
                              ? "bg-purple-100 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/60 rounded-tr-xs text-left"
                              : "bg-surface-elevated border border-border rounded-tl-xs text-left"
                          }`}
                        >
                          <div
                            className={`text-[11px] font-semibold ${
                              isRight ? "text-purple-900 dark:text-purple-300" : "text-text-muted"
                            }`}
                          >
                            {agent.title}
                          </div>
                          <div className="flex items-center gap-1.5 py-0.5 text-purple-400 font-mono font-bold text-sm leading-none">
                            <span className="animate-pulse [animation-delay:-0.3s]">.</span>
                            <span className="animate-pulse [animation-delay:-0.15s]">.</span>
                            <span className="animate-pulse">.</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Jump to Latest Floating Button */}
            {showScrollBottom && (
              <button
                type="button"
                onClick={() => {
                  isUserScrolledUp.current = false;
                  setShowScrollBottom(false);
                  scrollToBottom("smooth");
                }}
                className="absolute bottom-4 right-4 z-20 px-3.5 py-1.5 bg-surface-elevated hover:bg-surface-elevated/90 text-text font-mono text-xs font-semibold rounded-full shadow-lg border border-border flex items-center gap-1.5 cursor-pointer backdrop-blur-xs transition-all"
              >
                <span>Jump to Latest</span>
                <span>↓</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Other 3 Agents */}
        <aside className="lg:col-span-3 space-y-3 order-3 lg:order-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
            {rightPersonas.map(renderAgentCard)}
          </div>
        </aside>
      </div>
    </div>
  );
}

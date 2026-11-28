"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ErrorPopup } from "@/components/ui/error-popup";
import { Badge } from "@/components/ui/badge";
import { FullPageLoading, LoadingSpinner } from "@/components/ui/loading-spinner";
import { AppShell } from "@/components/layout/app-shell";
import { EvaluationOnChainPanel } from "@/components/solana/evaluation-onchain-panel";
import type { DefenseRevision } from "@/lib/reports/types";

function getAgentAvatarForPersona(persona?: string, role?: string): {
  src: string;
  name: string;
  title: string;
} {
  const p = (persona || "").toLowerCase();
  const r = (role || "").toLowerCase();

  if (p.includes("hiring manager") || r.includes("hiring_manager")) {
    return {
      src: "/Agents_PP/Stern Green Hiring Manager.png",
      name: "Marcus Vance",
      title: "Hiring Manager",
    };
  }
  if (p.includes("hr") || p.includes("recruiter") || r.includes("hr_recruiter")) {
    return {
      src: "/Agents_PP/HR.png",
      name: "Sarah Jenkins",
      title: "Senior HR Recruiter",
    };
  }
  if (p.includes("career") || p.includes("strategist") || r.includes("career_strategist")) {
    return {
      src: "/Agents_PP/Confident Plush Career Strategist.png",
      name: "Morgan Blake",
      title: "Career Strategist",
    };
  }
  if (p.includes("red flag") || r.includes("red_flag_analyst")) {
    return {
      src: "/Agents_PP/Furry Red Flags Investigator.png",
      name: "Jordan Reed",
      title: "Red Flag Investigator",
    };
  }
  if (p.includes("ats") || r.includes("ats_scanner")) {
    return {
      src: "/Agents_PP/Fuzzy ATS Resume Inspector Mascot.png",
      name: "Dexter",
      title: "ATS Resume Inspector",
    };
  }

  return {
    src: "/Agents_PP/Tech.png",
    name: "Alex Rivera",
    title: "Lead Technical Evaluator",
  };
}

export default function DefendScorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ claim?: string }>;
}) {
  const { id } = use(params);
  const resolvedSearchParams = use(searchParams);
  const initialClaim = resolvedSearchParams?.claim || "";

  const [revisions, setRevisions] = useState<DefenseRevision[]>([]);
  const [selectedRevIndex, setSelectedRevIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form State
  const [claimOrFlag, setClaimOrFlag] = useState(initialClaim);
  const [defenseText, setDefenseText] = useState("");
  const [supportingEvidence, setSupportingEvidence] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function loadRevisions() {
      try {
        const data = await apiFetch<DefenseRevision[]>(
          `/api/evaluations/${id}/defense`
        );
        if (!ignore) {
          setRevisions(data);
          setSelectedRevIndex(0);
        }
      } catch (err: unknown) {
        if (!ignore) {
          const message =
            err instanceof Error ? err.message : "Failed to load defense history";
          setError(message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadRevisions();
    return () => {
      ignore = true;
    };
  }, [id, reloadKey]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!claimOrFlag.trim() || !defenseText.trim()) {
      setError("Please specify the criticism to contest and your factual defense explanation.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const newRev = await apiFetch<DefenseRevision>(
        `/api/evaluations/${id}/defense`,
        {
          method: "POST",
          body: JSON.stringify({
            claimOrFlag: claimOrFlag.trim(),
            defenseText: defenseText.trim(),
            supportingEvidence: supportingEvidence.trim() || undefined,
          }),
        }
      );

      setRevisions((prev) => [newRev, ...prev]);
      setSelectedRevIndex(0);
      if (newRev.scoreDelta > 0) {
        setSuccessMessage(
          `Committee Reassessment complete! Score adjusted by +${newRev.scoreDelta} pts (${newRev.previousScore} → ${newRev.newScore}).`
        );
      } else {
        setSuccessMessage(null);
      }
      setDefenseText("");
      setSupportingEvidence("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to submit defense";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const activeRev = revisions[selectedRevIndex] ?? revisions[0];
  const primaryDialogue = activeRev?.committeeDialogue?.[0];
  const secondaryDialogues = activeRev?.committeeDialogue?.slice(1) ?? [];
  const primaryAgent = getAgentAvatarForPersona(
    primaryDialogue?.persona,
    primaryDialogue?.role
  );

  if (loading) {
    return <FullPageLoading />;
  }

  return (
    <AppShell
      title="Defend Yourself Room"
      description="Present missing architectural context, technical specifics, or code evidence to appeal evaluation deductions."
      action={
        <Link href={`/evaluations/${id}/report`}>
          <Button variant="outline" size="sm" className="text-xs font-semibold whitespace-nowrap">
            ← Back to Report
          </Button>
        </Link>
      }
    >
      <div className="space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-text-muted">
          <Link href="/profile" className="hover:text-text transition-colors">
            Profile
          </Link>
          <span>/</span>
          <Link href={`/evaluations/${id}/report`} className="hover:text-text transition-colors">
            Report ({id.slice(0, 8)})
          </Link>
          <span>/</span>
          <span className="text-text font-bold">Defend Yourself</span>
        </div>

        {/* Solana On-Chain Defense Sync */}
        <EvaluationOnChainPanel key={revisions.length} evaluationId={id} compact />

        <ErrorPopup
          title="Defense Notice"
          message={error}
          onDismiss={() => setError(null)}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                setError(null);
                setReloadKey((k) => k + 1);
              }}
              className="text-xs"
            >
              Retry
            </Button>
          }
        />

        {successMessage && (
          <Alert variant="success" title="Reassessment Successful">
            {successMessage}
          </Alert>
        )}

        {/* 2-Sided Split Layout: Left = Entry Form, Right = Reviewing Agent Response */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* LEFT SIDE: Defense Entry Form */}
          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6 shadow-sm space-y-5">
              <div className="border-b border-border pb-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base sm:text-lg font-extrabold text-text tracking-tight">
                    Submit Your Defense
                  </h2>
                  <Badge variant="purple" className="text-[11px] font-mono font-bold">
                    Committee Appeal
                  </Badge>
                </div>
                <p className="text-xs sm:text-sm text-text-secondary mt-1 leading-relaxed">
                  Contest an unfair deduction by providing production context, architectural facts, or code links.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Field 1: Criticism to contest */}
                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-bold text-text block">
                    Criticism or Gap to Defend
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Missing Kubernetes or Production Cloud Experience"
                    value={claimOrFlag}
                    onChange={(e) => setClaimOrFlag(e.target.value)}
                    required
                    className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-medium text-text placeholder:text-text-muted focus:outline-hidden focus:border-purple-500 transition-colors"
                  />
                </div>

                {/* Field 2: Explanation & Facts */}
                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-bold text-text block">
                    Your Explanation & Technical Facts
                  </label>
                  <textarea
                    placeholder="Explain the actual context from your experience, technical decisions made, scale handled, or how you solved this challenge..."
                    value={defenseText}
                    onChange={(e) => setDefenseText(e.target.value)}
                    rows={5}
                    required
                    onKeyDown={(e) => {
                      if (
                        (e.metaKey || e.ctrlKey) &&
                        e.key === "Enter" &&
                        defenseText.length >= 10 &&
                        !submitting
                      ) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                    className="w-full bg-surface-elevated border border-border rounded-xl p-3.5 text-xs sm:text-sm font-medium text-text placeholder:text-text-muted focus:outline-hidden focus:border-purple-500 resize-none transition-colors leading-relaxed"
                  />
                  <div className="flex justify-between items-center text-[11px] font-mono text-text-muted pt-0.5">
                    <span>Press Cmd+Enter to submit</span>
                    <span>{defenseText.length}/2000 chars (min 10)</span>
                  </div>
                </div>

                {/* Field 3: Supporting Evidence (Optional) */}
                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-semibold text-text-muted block">
                    Evidence or Repository Link (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="https://github.com/... or project link"
                    value={supportingEvidence}
                    onChange={(e) => setSupportingEvidence(e.target.value)}
                    className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-text placeholder:text-text-muted focus:outline-hidden focus:border-purple-500 transition-colors"
                  />
                </div>

                {/* Submit Action */}
                <div className="pt-2">
                  <Button
                    variant="primary"
                    type="submit"
                    size="lg"
                    isLoading={submitting}
                    disabled={defenseText.trim().length < 10 || !claimOrFlag.trim()}
                    className="w-full py-3 text-sm sm:text-base font-bold shadow-md whitespace-nowrap"
                  >
                    {submitting ? "Deliberating Defense..." : "Submit Defense for Review"}
                  </Button>
                </div>
              </form>
            </div>

            {/* Past Revisions Switcher */}
            {revisions.length > 1 && (
              <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-3 shadow-xs">
                <div className="flex items-center justify-between border-b border-border pb-2.5">
                  <h3 className="text-xs sm:text-sm font-bold text-text">
                    All Reassessments ({revisions.length})
                  </h3>
                  <span className="text-[11px] font-mono text-text-muted">
                    Click to view agent ruling
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {revisions.map((rev, idx) => (
                    <button
                      key={rev.revisionNumber}
                      type="button"
                      onClick={() => setSelectedRevIndex(idx)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border whitespace-nowrap shrink-0 ${
                        selectedRevIndex === idx
                          ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                          : "bg-surface-elevated text-text hover:border-purple-400 border-border"
                      }`}
                    >
                      <span>Rev #{rev.revisionNumber}</span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.2 rounded-md ${
                          rev.scoreDelta > 0
                            ? selectedRevIndex === idx
                              ? "bg-white/20 text-white"
                              : "bg-green-500/10 text-green-500 dark:text-green-400"
                            : selectedRevIndex === idx
                            ? "bg-white/20 text-white"
                            : "bg-surface text-text-muted"
                        }`}
                      >
                        {rev.scoreDelta > 0 ? `+${rev.scoreDelta} pts` : "0 pts"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT SIDE: Reviewing Agent Identity & Speech Card */}
          <div className="lg:col-span-7 space-y-5">
            {submitting ? (
              /* Reviewing In Progress Card */
              <div className="rounded-2xl border border-purple-500/40 bg-surface p-8 sm:p-10 shadow-lg space-y-6 text-center">
                <div className="relative w-24 h-24 mx-auto">
                  <div className="absolute inset-0 rounded-2xl bg-purple-500/20 animate-ping" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/Agents_PP/Tech.png"
                    alt="Alex Rivera"
                    className="relative w-24 h-24 rounded-2xl border-2 border-purple-500 object-cover shadow-xl bg-zinc-900"
                  />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg sm:text-xl font-extrabold text-text">
                    Alex Rivera is Reviewing Your Defense
                  </h3>
                  <p className="text-xs sm:text-sm text-text-secondary max-w-md mx-auto leading-relaxed">
                    Analyzing architectural specifics, technical evidence, and cross-checking against role benchmarks. Deliberating score adjustment...
                  </p>
                </div>
                <div className="flex justify-center">
                  <LoadingSpinner size="md" label="Committee Deliberating..." />
                </div>
              </div>
            ) : !activeRev ? (
              /* Empty / Waiting Card */
              <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5 border-b border-border pb-6">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/Agents_PP/Tech.png"
                    alt="Alex Rivera - Lead Technical Evaluator"
                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border-2 border-purple-500/30 object-cover shadow-md bg-zinc-900 shrink-0"
                  />
                  <div className="text-center sm:text-left space-y-1">
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                      <h3 className="text-lg sm:text-xl font-extrabold text-text">
                        Alex Rivera
                      </h3>
                      <Badge variant="purple" className="text-[11px] font-bold">
                        Lead Technical Evaluator
                      </Badge>
                    </div>
                    <p className="text-xs sm:text-sm font-semibold text-text-secondary">
                      Hiring Committee Appeal Panel
                    </p>
                    <p className="text-xs text-text-muted">
                      Status: Standing by for candidate defense submission
                    </p>
                  </div>
                </div>

                {/* Welcoming Speech Bubble */}
                <div className="relative rounded-2xl bg-surface-elevated/70 border border-border p-5 sm:p-6 space-y-3">
                  <div className="text-xs font-mono font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                    Evaluator Dialogue
                  </div>
                  <p className="text-sm sm:text-base font-medium text-text leading-relaxed">
                    &ldquo;Did our committee deduct points for missing production scale, framework architecture, or proprietary accomplishments?
                    State your technical case on the left. Include real numbers, system constraints, or code links.
                    If your defense proves real competence, we will award bounded score points immediately.&rdquo;
                  </p>
                </div>

                {/* Scoring Criteria Guide */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div className="p-3.5 rounded-xl bg-surface-elevated/50 border border-border space-y-1">
                    <div className="text-xs font-bold text-green-500 dark:text-green-400">
                      Earns Points (+2 to +5 pts)
                    </div>
                    <p className="text-xs text-text-muted leading-relaxed">
                      Production metrics, architecture decisions, framework specifics, or public repo links.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-surface-elevated/50 border border-border space-y-1">
                    <div className="text-xs font-bold text-amber-500 dark:text-amber-400">
                      Rejected (0 pts)
                    </div>
                    <p className="text-xs text-text-muted leading-relaxed">
                      Generic excuses, emotional appeals, restating the question, or unverified claims.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* ACTIVE DEFENSE EVALUATION & AGENT RESPONSE */
              <div className="rounded-2xl border border-border bg-surface p-5 sm:p-7 shadow-sm space-y-6">
                {/* Agent Identity & Header */}
                <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4 border-b border-border pb-5">
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={primaryAgent.src}
                      alt={primaryAgent.name}
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border-2 border-purple-500/40 object-cover shadow-md bg-zinc-900 shrink-0"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base sm:text-lg font-extrabold text-text">
                          {primaryDialogue?.persona || primaryAgent.name}
                        </h3>
                        <Badge variant="purple" className="text-[10px] font-bold">
                          {primaryAgent.title}
                        </Badge>
                      </div>
                      <p className="text-xs text-text-muted font-mono mt-0.5">
                        Revision #{activeRev.revisionNumber} Deliberation
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-mono text-text-muted">
                      {new Date(activeRev.submittedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* High-Impact Score Adjustment Banner */}
                <div
                  className={`rounded-2xl p-4 sm:p-5 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    activeRev.scoreDelta > 0
                      ? "bg-green-500/10 border-green-500/30 dark:bg-green-950/20"
                      : "bg-surface-elevated border-border"
                  }`}
                >
                  <div>
                    <div className="text-xs font-mono font-bold uppercase tracking-wider text-text-muted">
                      Score Adjustment
                    </div>
                    <div
                      className={`text-2xl sm:text-3xl font-extrabold font-mono mt-0.5 ${
                        activeRev.scoreDelta > 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-amber-500 dark:text-amber-400"
                      }`}
                    >
                      {activeRev.scoreDelta > 0
                        ? `+${activeRev.scoreDelta} PTS AWARDED`
                        : "0 PTS (UNMODIFIED)"}
                    </div>
                  </div>

                  <div className="text-left sm:text-right">
                    <div className="text-xs font-mono text-text-muted">Composite Score</div>
                    <div className="text-base sm:text-lg font-bold text-text font-mono">
                      {activeRev.scoreDelta > 0 ? (
                        <>
                          <span className="line-through text-text-muted mr-1.5">
                            {activeRev.previousScore}
                          </span>
                          <span className="text-green-500">→ {activeRev.newScore} / 100</span>
                        </>
                      ) : (
                        <span>{activeRev.previousScore} / 100</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* THE AGENT'S SPEECH BUBBLE: Talking about the defense line */}
                <div className="space-y-3">
                  <div className="text-xs font-bold text-text uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <span>Evaluator Statement on:</span>
                    <span className="text-purple-600 dark:text-purple-400">
                      &ldquo;{activeRev.claimOrFlag}&rdquo;
                    </span>
                  </div>

                  {/* Speech Bubble Card */}
                  <div className="relative rounded-2xl bg-surface-elevated border border-purple-500/20 p-5 sm:p-6 shadow-xs space-y-2">
                    <p className="text-base sm:text-lg font-bold text-text leading-relaxed">
                      &ldquo;
                      {primaryDialogue?.comment || activeRev.reassessmentRationale}
                      &rdquo;
                    </p>
                  </div>
                </div>

                {/* Secondary Committee Dialogues (e.g., Hiring Manager response) */}
                {secondaryDialogues.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <div className="text-xs font-mono font-bold uppercase tracking-wider text-text-muted">
                      Committee Panel Consensus
                    </div>
                    {secondaryDialogues.map((dlg, idx) => {
                      const secondaryAgent = getAgentAvatarForPersona(dlg.persona, dlg.role);
                      return (
                        <div
                          key={idx}
                          className="flex items-start gap-3.5 p-3.5 rounded-xl bg-surface-elevated/60 border border-border"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={secondaryAgent.src}
                            alt={secondaryAgent.name}
                            className="w-10 h-10 rounded-xl border border-border object-cover bg-zinc-900 shrink-0"
                          />
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-text">
                                {dlg.persona || secondaryAgent.name}
                              </span>
                              <span className="text-[10px] font-mono text-text-muted">
                                {secondaryAgent.title}
                              </span>
                            </div>
                            <p className="text-xs sm:text-sm font-medium text-text-secondary leading-relaxed">
                              &ldquo;{dlg.comment}&rdquo;
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Candidate's Contested Submission Recap */}
                <div className="rounded-xl bg-surface-elevated/40 border border-border p-4 space-y-2">
                  <div className="text-xs font-bold text-text-muted uppercase tracking-wider font-mono">
                    Your Submitted Context
                  </div>
                  <p className="text-xs sm:text-sm text-text-secondary leading-relaxed italic">
                    &ldquo;{activeRev.defenseText}&rdquo;
                  </p>
                  {activeRev.supportingEvidence && (
                    <div className="text-xs text-text-muted pt-1">
                      <span className="font-semibold text-text">Evidence: </span>
                      <a
                        href={activeRev.supportingEvidence}
                        target="_blank"
                        rel="noreferrer"
                        className="text-purple-500 hover:underline font-mono break-all"
                      >
                        {activeRev.supportingEvidence}
                      </a>
                    </div>
                  )}
                </div>

                {/* Official Committee Ruling Summary */}
                <div className="rounded-xl bg-surface-elevated border border-border p-4 space-y-2">
                  <div className="text-xs font-bold text-text font-mono uppercase tracking-wider">
                    Official Committee Ruling
                  </div>
                  <p className="text-xs sm:text-sm font-medium text-text-secondary leading-relaxed">
                    {activeRev.reassessmentRationale}
                  </p>
                  {activeRev.revisedFindings && activeRev.revisedFindings.length > 0 && (
                    <div className="pt-2 border-t border-border/60 space-y-1">
                      <div className="text-[11px] font-mono text-text-muted">
                        Updated Findings:
                      </div>
                      <ul className="space-y-1 text-xs text-text font-medium">
                        {activeRev.revisedFindings.map((f, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-purple-500 font-bold">•</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
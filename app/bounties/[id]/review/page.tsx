"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { apiFetch } from "@/lib/client/api";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";
import { BountyCompanyLogo } from "@/components/solana/bounty-company-logo";

interface FraudSignal {
  category: string;
  severity: string;
  finding: string;
  evidence: string;
}

interface FakeDetectorReport {
  isFlagged: boolean;
  riskScore: number;
  verdict: string;
  summary: string;
  signals: FraudSignal[];
  modelVersion?: string;
}

interface AgentRunItem {
  evaluationId: string;
  agentRole: string;
  scoreContribution: number | null;
  structuredResult: {
    displayName?: string;
    position?: string;
    voiceCommentary?: string;
    findings?: Array<{
      claim: string;
      severity: string;
      evidenceSnippet: string;
    }>;
  } | null;
}

interface SubmissionItem {
  id: string;
  bountyId: string;
  candidateUserId: string;
  candidateName: string;
  candidateEmail: string;
  candidateWallet: string | null;
  evaluationId: string;
  resumeHash: string;
  fakeDetectorStatus: string;
  fakeDetectorScore: number | null;
  fakeDetectorReport: FakeDetectorReport | null;
  reviewStatus: string;
  slotReservedAt: string | null;
  reviewDeadlineAt: string | null;
  reviewedAt: string | null;
  recruiterNotes: string | null;
  cvText: string;
  overallScore: number | null;
  verdict: string | null;
  evalTxSignature: string | null;
  evalPdaAddress: string | null;
  canonicalReportHash: string | null;
  structuredReport: {
    explanation?: string;
    redFlags?: Array<{ flag: string; evidenceSnippet: string }>;
    strengths?: string[];
  } | null;
  agentRuns: AgentRunItem[];
  isReviewExpired: boolean;
  remainingReviewLabel: string | null;
}

interface RestrictionItem {
  id: string;
  userId: string | null;
  walletAddress: string | null;
  resumeHash: string | null;
  reason: string;
  details: string;
  createdAt: string;
}

interface WorkspaceResponse {
  bounty: {
    id: string;
    title: string;
    company: string;
    companyLogoUrl?: string | null;
    minScore: number;
    maxWinners: number;
    claimsCount: number;
    status: string;
    rewardPerWinnerUsdc: number;
    totalPoolUsdc: number;
    expiresAt: string;
  };
  slotMetrics: {
    maxWinners: number;
    claimsCount: number;
    reservedCount: number;
    pendingReviewCount: number;
    approvedCount: number;
    occupiedSlots: number;
    availableSlots: number;
  };
  submissions: SubmissionItem[];
  restrictions: RestrictionItem[];
}

const ROLE_LABELS: Record<string, string> = {
  hr_recruiter: "HR Recruiter",
  technical_interviewer: "Technical Interviewer",
  ats_scanner: "ATS Scanner",
  hiring_manager: "Hiring Manager",
  career_strategist: "Career Strategist",
  red_flag_analyst: "Red Flag Analyst",
};

function statusLabel(status: string): string {
  switch (status) {
    case "pending_review":
      return "Pending Review";
    case "approved":
      return "Approved · Payout Unlocked";
    case "claimed":
      return "Paid On-Chain";
    case "rejected":
      return "Rejected & Restricted";
    case "blocked_duplicate":
      return "Blocked (Duplicate Resume)";
    case "blocked_fake":
      return "Blocked (Fake Detector)";
    case "below_threshold":
      return "Below Min Score";
    default:
      return "Evaluating / Waitlist";
  }
}

export default function BountyPublisherReviewPage() {
  const params = useParams<{ id: string }>();
  const bountyId = params?.id;
  const { publicKey, signAndSubmitTx, clusterLabel } = useSolanaWallet();

  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notesBySubId, setNotesBySubId] = useState<Record<string, string>>({});
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showFullCv, setShowFullCv] = useState(true);

  const loadWorkspace = useCallback(async () => {
    if (!bountyId) return;
    setLoading(true);
    try {
      const res = await apiFetch<WorkspaceResponse>(
        `/api/solana/bounties/${bountyId}/review`
      );
      setData(res);
      if (res.submissions.length > 0) {
        setSelectedId((prev) => {
          if (prev && res.submissions.some((s) => s.id === prev)) return prev;
          const pendingFirst = res.submissions.find(
            (s) => s.reviewStatus === "pending_review"
          );
          return (pendingFirst ?? res.submissions[0]).id;
        });
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load Bounty Publisher review workspace."
      );
    } finally {
      setLoading(false);
    }
  }, [bountyId]);

  useEffect(() => {
    if (!bountyId) return;
    let active = true;
    (async () => {
      try {
        const res = await apiFetch<WorkspaceResponse>(
          `/api/solana/bounties/${bountyId}/review`
        );
        if (!active) return;
        setData(res);
        if (res.submissions.length > 0) {
          setSelectedId((prev) => {
            if (prev && res.submissions.some((s) => s.id === prev)) return prev;
            const pendingFirst = res.submissions.find(
              (s) => s.reviewStatus === "pending_review"
            );
            return (pendingFirst ?? res.submissions[0]).id;
          });
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load Bounty Publisher review workspace."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [bountyId]);

  const selected =
    data?.submissions.find((s) => s.id === selectedId) ?? data?.submissions[0] ?? null;

  const activeNotes = selected
    ? notesBySubId[selected.id] ?? selected.recruiterNotes ?? ""
    : "";

  const handleDecision = async (action: "approve" | "reject") => {
    if (!selected || !bountyId) return;
    setSubmittingAction(action);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/solana/bounties/${bountyId}/review`, {
        method: "POST",
        body: JSON.stringify({
          submissionId: selected.id,
          action,
          recruiterNotes: activeNotes,
        }),
      });

      setNotice(
        action === "approve"
          ? "Approved! Review hold cleared — candidate can now claim the USDC escrow payout on-chain immediately."
          : "Candidate rejected & flagged. Winner slot freed and account/wallet/resume hash permanently restricted."
      );
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save review decision.");
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleDirectTestPayout = async () => {
    if (!selected || !bountyId || !publicKey) return;
    setSubmittingAction("payout");
    setError(null);
    setNotice(null);
    try {
      const prepared = await apiFetch<{ serializedTxBase64: string }>(
        `/api/solana/bounties/${bountyId}/claim`,
        {
          method: "POST",
          body: JSON.stringify({
            walletAddress: publicKey,
            evaluationId: selected.evaluationId,
          }),
        }
      );
      const txSignature = await signAndSubmitTx(prepared.serializedTxBase64);
      const confirmed = await apiFetch<{ amountPaidUsdc: number }>(
        `/api/solana/bounties/${bountyId}/claim`,
        {
          method: "PATCH",
          body: JSON.stringify({
            walletAddress: publicKey,
            evaluationId: selected.evaluationId,
            txSignature,
          }),
        }
      );
      setNotice(
        `Released ${confirmed.amountPaidUsdc} USDC payout on Solana ${clusterLabel}! Tx: ${txSignature}`
      );
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute on-chain payout.");
    } finally {
      setSubmittingAction(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4 py-16 flex justify-center">
        <LoadingSpinner size="lg" label="Loading Publisher Review Workspace..." />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-10 space-y-4">
        <Link
          href="/bounties"
          className="text-xs font-mono text-text-muted hover:text-purple-400"
        >
          ← Back to Bounties
        </Link>
        <div className="rounded-xl border border-border bg-surface p-5 space-y-1.5">
          <p className="text-sm font-semibold text-purple-400">
            Access Denied or Not Found
          </p>
          <p className="text-sm text-text-secondary">
            {error || "Unable to load this bounty review workspace."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-border">
        <div className="space-y-1">
          <Link
            href="/bounties"
            className="text-xs font-mono text-text-muted hover:text-purple-400 transition-colors"
          >
            ← Back to Bounties
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <BountyCompanyLogo
              company={data.bounty.company}
              logoUrl={data.bounty.companyLogoUrl}
              size="lg"
            />
            <h1 className="text-2xl sm:text-3xl font-extrabold text-text">
              Publisher Review · {data.bounty.title}
            </h1>
            <span className="px-2 py-0.5 text-xs font-mono rounded-md bg-surface-elevated border border-border text-purple-400">
              {data.bounty.company}
            </span>
          </div>
          <p className="text-xs text-text-secondary">
            Min Score {data.bounty.minScore}/100 · {data.bounty.rewardPerWinnerUsdc} USDC per winner ·
            24h Review Window
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={() => void loadWorkspace()}>
          Refresh Queue
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-border bg-surface p-5 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-purple-400">Review Action Notice</p>
            <p className="text-sm text-text-secondary">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-border bg-surface p-5 space-y-1">
          <p className="text-sm font-semibold text-purple-400">Review Updated</p>
          <p className="text-sm text-text-secondary">{notice}</p>
        </div>
      )}

      {/* Slot & Anti-Fraud Metrics Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-lg bg-surface border border-border">
          <span className="text-[11px] font-mono uppercase text-text-muted">
            Reserved (Pending Review)
          </span>
          <p className="text-2xl font-extrabold text-purple-400 mt-1">
            {data.slotMetrics.pendingReviewCount}
          </p>
        </div>
        <div className="p-4 rounded-lg bg-surface border border-border">
          <span className="text-[11px] font-mono uppercase text-text-muted">
            Paid / Approved
          </span>
          <p className="text-2xl font-extrabold text-text mt-1">
            {data.slotMetrics.claimsCount + data.slotMetrics.approvedCount} /{" "}
            {data.slotMetrics.maxWinners}
          </p>
        </div>
        <div className="p-4 rounded-lg bg-surface border border-border">
          <span className="text-[11px] font-mono uppercase text-text-muted">
            Open Slots
          </span>
          <p className="text-2xl font-extrabold text-text mt-1">
            {data.slotMetrics.availableSlots}
          </p>
        </div>
        <div className="p-4 rounded-lg bg-surface border border-border">
          <span className="text-[11px] font-mono uppercase text-text-muted">
            Restricted
          </span>
          <p className="text-2xl font-extrabold text-red-400 mt-1">
            {data.restrictions.length}
          </p>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Submissions & Restrictions */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="bg-surface border-border rounded-xl">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-extrabold uppercase tracking-wider text-text">
                Submissions ({data.submissions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3 space-y-2.5 max-h-[540px] overflow-y-auto">
              {data.submissions.length === 0 ? (
                <p className="text-xs text-text-secondary py-6 text-center">
                  No candidate submissions recorded for this bounty yet.
                </p>
              ) : (
                data.submissions.map((sub) => {
                  const isActive = selected?.id === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setSelectedId(sub.id)}
                      className={`w-full text-left p-3.5 rounded-lg border transition-colors cursor-pointer space-y-2 bg-surface-elevated ${
                        isActive
                          ? "border-purple-500/60"
                          : "border-border hover:border-purple-500/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-text truncate">
                            {sub.candidateName || sub.candidateEmail}
                          </p>
                          <p className="text-[11px] font-mono text-text-muted truncate">
                            Hash: {sub.resumeHash.slice(0, 14)}...
                          </p>
                        </div>
                        <span className="text-sm font-extrabold font-mono text-purple-400 shrink-0">
                          {sub.overallScore ?? "—"}/100
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface border border-border ${
                            sub.reviewStatus.startsWith("blocked") ||
                            sub.reviewStatus === "rejected"
                              ? "text-red-400"
                              : sub.reviewStatus === "approved" ||
                                sub.reviewStatus === "claimed"
                              ? "text-purple-400"
                              : "text-text-secondary"
                          }`}
                        >
                          {statusLabel(sub.reviewStatus)}
                        </span>
                        {sub.remainingReviewLabel && (
                          <span className="text-[10px] font-mono text-text-muted">
                            {sub.remainingReviewLabel}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Restricted Log */}
          <Card className="bg-surface border-border rounded-xl">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-extrabold uppercase tracking-wider text-text">
                Restricted Entities ({data.restrictions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3 space-y-2.5 max-h-[340px] overflow-y-auto">
              {data.restrictions.length === 0 ? (
                <p className="text-xs text-text-secondary py-4 text-center">
                  No restricted users, wallets, or resume hashes logged.
                </p>
              ) : (
                data.restrictions.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 rounded-lg bg-surface-elevated border border-border space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface border border-border text-red-400">
                        {r.reason.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] font-mono text-text-muted">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-text-secondary leading-snug">{r.details}</p>
                    <div className="text-[10px] font-mono text-text-muted space-y-0.5 pt-1">
                      {r.walletAddress && <p className="truncate">Wallet: {r.walletAddress}</p>}
                      {r.resumeHash && <p className="truncate">SHA-256: {r.resumeHash}</p>}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Deep Submission Inspector */}
        <div className="lg:col-span-8 space-y-6">
          {!selected ? (
            <div className="rounded-xl border border-border bg-surface p-12 text-center text-sm text-text-secondary">
              Select a submission from the left queue to inspect its full CV, 6-agent review,
              and Fake Resume Detector report.
            </div>
          ) : (
            <>
              {/* Candidate Header & Decision Controls */}
              <Card className="bg-surface border-border rounded-xl">
                <CardHeader className="pb-4 border-b border-border">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-extrabold text-text">
                          {selected.candidateName}
                        </h2>
                        <span className="px-2 py-0.5 text-[11px] font-mono rounded-md bg-surface-elevated border border-border text-purple-400">
                          {statusLabel(selected.reviewStatus)}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-text-muted mt-1">
                        {selected.candidateEmail} · Score:{" "}
                        <span className="text-purple-400 font-bold">
                          {selected.overallScore ?? "—"}/100
                        </span>{" "}
                        ({selected.verdict || "Evaluated"})
                      </p>
                    </div>

                    {selected.remainingReviewLabel && (
                      <div className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-border text-xs font-mono text-text">
                        Review Window:{" "}
                        <span className="text-purple-400 font-bold">
                          {selected.remainingReviewLabel}
                        </span>
                      </div>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="pt-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-lg bg-surface-elevated border border-border space-y-1">
                      <span className="text-[10px] text-text-muted uppercase">
                        Normalized Resume SHA-256
                      </span>
                      <p className="text-text break-all">{selected.resumeHash}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-surface-elevated border border-border space-y-1">
                      <span className="text-[10px] text-text-muted uppercase">
                        Candidate Solana Wallet
                      </span>
                      <p className="text-text break-all">
                        {selected.candidateWallet || "Not anchored to wallet yet"}
                      </p>
                    </div>
                  </div>

                  {/* Custom Red-Flag Notes */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-text">
                      Recruiter Red-Flag / Review Notes
                    </label>
                    <Textarea
                      rows={3}
                      placeholder="Add optional verification notes or specific red flags if rejecting this candidate..."
                      value={activeNotes}
                      onChange={(e) =>
                        setNotesBySubId((prev) => ({
                          ...prev,
                          [selected.id]: e.target.value,
                        }))
                      }
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {selected.reviewStatus === "pending_review" && (
                        <Button
                          variant="primary"
                          size="md"
                          isLoading={submittingAction === "approve"}
                          onClick={() => void handleDecision("approve")}
                        >
                          Approve & Unlock Payout
                        </Button>
                      )}

                      {selected.reviewStatus !== "claimed" &&
                        selected.reviewStatus !== "rejected" &&
                        !selected.reviewStatus.startsWith("blocked") && (
                          <Button
                            variant="danger"
                            size="md"
                            isLoading={submittingAction === "reject"}
                            onClick={() => void handleDecision("reject")}
                          >
                            Reject / Flag & Restrict Permanently
                          </Button>
                        )}

                      {selected.reviewStatus === "approved" &&
                        publicKey &&
                        selected.candidateWallet === publicKey &&
                        selected.evalTxSignature && (
                          <Button
                            variant="outline"
                            size="md"
                            isLoading={submittingAction === "payout"}
                            onClick={() => void handleDirectTestPayout()}
                          >
                            Execute Candidate Claim On-Chain →
                          </Button>
                        )}
                    </div>

                    <span className="text-[11px] font-mono text-text-muted">
                      Approving clears the 24h hold immediately for on-chain USDC release.
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Fake Resume Detector Agent Report */}
              <Card className="bg-surface border-border rounded-xl">
                <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-extrabold uppercase tracking-wider text-text">
                    Fake Resume Detector Agent Report
                  </CardTitle>
                  <span
                    className={`px-2 py-0.5 text-[11px] font-mono rounded-md bg-surface-elevated border border-border ${
                      selected.fakeDetectorStatus === "flagged"
                        ? "text-red-400"
                        : "text-purple-400"
                    }`}
                  >
                    {selected.fakeDetectorStatus.toUpperCase()} · Risk{" "}
                    {selected.fakeDetectorScore ?? 0}/100
                  </span>
                </CardHeader>
                <CardContent className="pt-4 space-y-3 text-xs">
                  <p className="text-text-secondary">
                    {selected.fakeDetectorReport?.summary ||
                      "No fabrication, keyword stuffing, or prompt injection detected."}
                  </p>
                  {selected.fakeDetectorReport?.signals &&
                    selected.fakeDetectorReport.signals.length > 0 && (
                      <div className="space-y-2">
                        {selected.fakeDetectorReport.signals.map((sig, idx) => (
                          <div
                            key={`${sig.category}-${idx}`}
                            className="p-3 rounded-lg bg-surface-elevated border border-border space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-text">{sig.finding}</span>
                              <span className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface border border-border text-text-muted">
                                {sig.category} · {sig.severity}
                              </span>
                            </div>
                            <p className="font-mono text-[11px] text-text-muted">
                              Evidence: {sig.evidence}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                </CardContent>
              </Card>

              {/* 6-Agent Committee Review Breakdown */}
              <Card className="bg-surface border-border rounded-xl">
                <CardHeader className="pb-3 border-b border-border">
                  <CardTitle className="text-sm font-extrabold uppercase tracking-wider text-text">
                    6-Agent Hiring Committee Review ({selected.agentRuns.length} Personas)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  {selected.structuredReport?.explanation && (
                    <div className="p-3.5 rounded-lg bg-surface-elevated border border-border text-xs text-text-secondary leading-relaxed">
                      <span className="block font-mono uppercase text-[10px] text-purple-400 font-bold mb-1">
                        Synthesis Summary
                      </span>
                      {selected.structuredReport.explanation}
                    </div>
                  )}

                  {selected.structuredReport?.redFlags &&
                    selected.structuredReport.redFlags.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-[11px] font-mono uppercase font-bold text-red-400">
                          Committee Red Flags ({selected.structuredReport.redFlags.length})
                        </span>
                        {selected.structuredReport.redFlags.map((rf, i) => (
                          <div
                            key={i}
                            className="p-3 rounded-lg border border-border bg-surface-elevated text-xs space-y-1"
                          >
                            <p className="font-semibold text-text">{rf.flag}</p>
                            <p className="font-mono text-[11px] text-text-muted">
                              &ldquo;{rf.evidenceSnippet}&rdquo;
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selected.agentRuns.map((run) => (
                      <div
                        key={run.agentRole}
                        className="p-3.5 rounded-lg bg-surface-elevated border border-border space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-text">
                            {run.structuredResult?.displayName ||
                              ROLE_LABELS[run.agentRole] ||
                              run.agentRole}
                          </span>
                          <span className="font-mono font-extrabold text-purple-400">
                            {run.scoreContribution ?? "—"}/100
                          </span>
                        </div>
                        {run.structuredResult?.position && (
                          <p className="text-text-secondary leading-relaxed">
                            {run.structuredResult.position}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Full Candidate Resume / CV Reader */}
              <Card className="bg-surface border-border rounded-xl">
                <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-extrabold uppercase tracking-wider text-text">
                    Full Submitted Resume / CV
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFullCv((v) => !v)}
                  >
                    {showFullCv ? "Collapse CV" : "Open Full CV"}
                  </Button>
                </CardHeader>
                {showFullCv && (
                  <CardContent className="pt-4">
                    <pre className="whitespace-pre-wrap font-mono text-xs text-text-secondary bg-surface-elevated p-4 rounded-lg border border-border max-h-[500px] overflow-y-auto leading-relaxed">
                      {selected.cvText}
                    </pre>
                  </CardContent>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

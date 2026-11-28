"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client/api";
import { ErrorPopup } from "@/components/ui/error-popup";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { BountyCompanyLogo } from "@/components/solana/bounty-company-logo";

interface EvaluationItem {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  tone: string;
  overallScore: number | null;
  verdict: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ComparisonHistoryRole {
  roleTitle: string;
  company: string;
  overallMatchScore: number;
  callbackProbability: number;
  isWinner: boolean;
}

interface ComparisonHistoryItem {
  id: string;
  createdAt: string;
  winningRoleTitle: string;
  comparisonSummary: string;
  rolesCount: number;
  roles: ComparisonHistoryRole[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fullResult: any;
}

const COMPANY_LOGOS: Record<string, string> = {
  meta: "https://upload.wikimedia.org/wikipedia/commons/7/7b/Meta_Platforms_Inc._logo.svg",
  google: "https://upload.wikimedia.org/wikipedia/commons/2/2f/Google_2015_logo.svg",
  netflix: "https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg",
  amazon: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg",
  apple: "https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg",
  microsoft: "https://upload.wikimedia.org/wikipedia/commons/9/96/Microsoft_logo_%282012%29.svg",
  uber: "https://upload.wikimedia.org/wikipedia/commons/c/cc/Uber_logo_2018.png",
  spotify: "https://upload.wikimedia.org/wikipedia/commons/1/19/Spotify_logo_without_text.svg",
  airbnb: "https://upload.wikimedia.org/wikipedia/commons/6/69/Airbnb_Logo_B%C3%A9lo.svg",
  stripe: "https://upload.wikimedia.org/wikipedia/commons/b/ba/Stripe_Logo%2C_revised_2016.svg",
};

function getCompanyLogoUrl(company: string): string | null {
  const norm = company.toLowerCase().trim();
  for (const [k, v] of Object.entries(COMPANY_LOGOS)) {
    if (norm.includes(k)) return v;
  }
  return null;
}

interface PersonalBountyItem {
  id: string;
  recruiterUserId: string;
  jobDescriptionId: string;
  title: string;
  company: string;
  companyLogoUrl?: string | null;
  minScore: number;
  rewardPerWinnerUsdc: number;
  maxWinners: number;
  claimsCount: number;
  approvedCount?: number;
  pendingReviewCount?: number;
  status: string;
  expiresAt: string;
  role: "published" | "entered";
  submissionStatus?: string | null;
  evaluationId?: string | null;
  overallScore?: number | null;
}

export default function HistoryPage() {
  const router = useRouter();
  const [evaluations, setEvaluations] = useState<EvaluationItem[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonHistoryItem[]>([]);
  const [myBounties, setMyBounties] = useState<PersonalBountyItem[]>([]);
  const [activeTab, setActiveTab] = useState<"bounties" | "reviews" | "compares">("reviews");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [evalData, bountyData] = await Promise.all([
          apiFetch<EvaluationItem[]>("/api/evaluations"),
          apiFetch<{
            currentUserId?: string | null;
            bounties?: Array<{
              id: string;
              recruiterUserId: string;
              jobDescriptionId: string;
              title: string;
              company: string;
              companyLogoUrl?: string | null;
              minScore: number;
              rewardPerWinnerUsdc: number;
              maxWinners: number;
              claimsCount: number;
              approvedCount?: number;
              pendingReviewCount?: number;
              status: string;
              expiresAt: string;
            }>;
            myEvaluations?: Array<{
              id: string;
              jobDescriptionId: string;
              overallScore: number | null;
            }>;
            mySubmissions?: Array<{
              bountyId: string;
              evaluationId: string;
              reviewStatus: string;
            }>;
          }>("/api/solana/bounties").catch(() => null),
        ]);
        setEvaluations(evalData || []);

        if (bountyData?.bounties && bountyData.currentUserId) {
          const uid = bountyData.currentUserId;
          const subsByBounty = new Map(
            (bountyData.mySubmissions ?? []).map((s) => [s.bountyId, s])
          );
          const evalsByJd = new Map(
            (bountyData.myEvaluations ?? []).map((e) => [e.jobDescriptionId, e])
          );

          const personal: PersonalBountyItem[] = [];
          for (const b of bountyData.bounties) {
            const isPublisher = b.recruiterUserId === uid;
            const sub = subsByBounty.get(b.id);
            const ev = evalsByJd.get(b.jobDescriptionId);
            if (isPublisher || sub || ev) {
              personal.push({
                ...b,
                role: isPublisher ? "published" : "entered",
                submissionStatus: sub?.reviewStatus ?? null,
                evaluationId: sub?.evaluationId ?? ev?.id ?? null,
                overallScore: ev?.overallScore ?? null,
              });
            }
          }
          setMyBounties(personal);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load reviews");
      } finally {
        setLoading(false);
      }

      // Load comparison history from localStorage / sessionStorage
      if (typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem("cookmycv_comparison_history");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              setComparisons(parsed);
            }
          } else {
            // Check fallback in sessionStorage
            const sessionRaw = sessionStorage.getItem("cookmycv_latest_comparison");
            if (sessionRaw) {
              const res = JSON.parse(sessionRaw);
              const fallbackItem: ComparisonHistoryItem = {
                id: "comp_latest",
                createdAt: new Date().toISOString(),
                winningRoleTitle: res.recommendedRole?.title || res.winningRoleTitle || "Top Recommended Role",
                comparisonSummary: res.comparisonSummary || "",
                rolesCount: res.roles?.length || res.roleRankings?.length || 0,
                roles: (res.roles || res.roleRankings || []).map(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (r: any) => ({
                    roleTitle: r.title || r.roleTitle,
                    company: r.company,
                    overallMatchScore: r.overallScore ?? r.overallMatchScore ?? 0,
                    callbackProbability:
                      r.interviewProbability ??
                      r.callbackProbability ??
                      Math.round((r.overallScore || 70) * 0.85),
                    isWinner:
                      (r.title || r.roleTitle) ===
                        (res.recommendedRole?.title || res.winningRoleTitle) ||
                      !!r.isWinner,
                  })
                ),
                fullResult: res,
              };
              setComparisons([fallbackItem]);
            }
          }
        } catch (_) {}
      }
    }
    loadData();
  }, []);

  const handleOpenComparison = (item: ComparisonHistoryItem) => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        "cookmycv_latest_comparison",
        JSON.stringify(item.fullResult)
      );
    }
    router.push("/comparisons/result");
  };

  if (loading) {
    return <FullPageLoading />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">
            History & Activity
          </h1>
          <p className="text-xs text-text-muted mt-1">
            Access past recruitment simulations, agent committee debates, and role comparisons.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/evaluations/new"
            className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs whitespace-nowrap"
          >
            + New Review
          </Link>
          <Link
            href="/comparisons"
            className="px-3.5 py-1.5 bg-surface-elevated hover:bg-surface-elevated/80 border border-border text-text text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            + Compare Roles
          </Link>
        </div>
      </div>

      <ErrorPopup
        title="History Notice"
        message={error}
        onDismiss={() => setError(null)}
      />

      {/* Mobile Activity Switcher */}
      <div className="flex lg:hidden items-center gap-2 border-b border-border pb-3 w-full overflow-x-auto">
        <button
          onClick={() => setActiveTab("bounties")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-colors ${
            activeTab === "bounties"
              ? "bg-purple-600 text-white shadow-xs"
              : "bg-surface-elevated border border-border text-text-muted hover:text-text"
          }`}
        >
          <span>My Bounties</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
              activeTab === "bounties"
                ? "bg-purple-700/80 text-white"
                : "bg-surface text-text-muted"
            }`}
          >
            {myBounties.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("reviews")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-colors ${
            activeTab === "reviews"
              ? "bg-purple-600 text-white shadow-xs"
              : "bg-surface-elevated border border-border text-text-muted hover:text-text"
          }`}
        >
          <span>My Reviews</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
              activeTab === "reviews"
                ? "bg-purple-700/80 text-white"
                : "bg-surface text-text-muted"
            }`}
          >
            {evaluations.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("compares")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-colors ${
            activeTab === "compares"
              ? "bg-purple-600 text-white shadow-xs"
              : "bg-surface-elevated border border-border text-text-muted hover:text-text"
          }`}
        >
          <span>Role Compares</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
              activeTab === "compares"
                ? "bg-purple-700/80 text-white"
                : "bg-surface text-text-muted"
            }`}
          >
            {comparisons.length}
          </span>
        </button>
      </div>

      {/* Main Layout: Desktop Sidebar + 2-Column Content */}
      <div className="w-full flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Sidebar (Desktop Only) */}
        <aside className="hidden lg:block lg:w-64 lg:min-w-[16rem] lg:max-w-[16rem] shrink-0 lg:sticky lg:top-20 space-y-4 bg-surface border border-border rounded-xl p-3 shadow-xs">
          <div className="space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted px-3.5 pt-1 pb-1">
              Activity Type
            </div>
            <nav className="space-y-1">
              {/* My Bounties Tab */}
              <button
                onClick={() => setActiveTab("bounties")}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm rounded-lg transition-all text-left cursor-pointer group ${
                  activeTab === "bounties"
                    ? "bg-surface-elevated text-text font-bold border border-border shadow-xs"
                    : "text-text-muted hover:text-text hover:bg-surface-elevated/60 font-semibold"
                }`}
              >
                <div className="flex items-center gap-3">
                  <svg
                    className={`w-4 h-4 shrink-0 ${
                      activeTab === "bounties" ? "text-purple-600 dark:text-purple-400" : "text-text-muted"
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>My Bounties</span>
                </div>
                <span
                  className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                    activeTab === "bounties"
                      ? "bg-purple-100 text-purple-900 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                      : "bg-surface-elevated text-text-muted border border-border"
                  }`}
                >
                  {myBounties.length}
                </span>
              </button>
              {/* My Reviews Tab */}
              <button
                onClick={() => setActiveTab("reviews")}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm rounded-lg transition-all text-left cursor-pointer group ${
                  activeTab === "reviews"
                    ? "bg-surface-elevated text-text font-bold border border-border shadow-xs"
                    : "text-text-muted hover:text-text hover:bg-surface-elevated/60 font-semibold"
                }`}
              >
                <div className="flex items-center gap-3">
                  <svg
                    className={`w-4 h-4 shrink-0 ${
                      activeTab === "reviews" ? "text-purple-600 dark:text-purple-400" : "text-text-muted"
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <span>My Reviews</span>
                </div>
                <span
                  className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                    activeTab === "reviews"
                      ? "bg-purple-100 text-purple-900 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                      : "bg-surface-elevated text-text-muted border border-border"
                  }`}
                >
                  {evaluations.length}
                </span>
              </button>

              {/* Role Compares Tab */}
              <button
                onClick={() => setActiveTab("compares")}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm rounded-lg transition-all text-left cursor-pointer group ${
                  activeTab === "compares"
                    ? "bg-surface-elevated text-text font-bold border border-border shadow-xs"
                    : "text-text-muted hover:text-text hover:bg-surface-elevated/60 font-semibold"
                }`}
              >
                <div className="flex items-center gap-3">
                  <svg
                    className={`w-4 h-4 shrink-0 ${
                      activeTab === "compares" ? "text-purple-600 dark:text-purple-400" : "text-text-muted"
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
                    />
                  </svg>
                  <span>Role Compares</span>
                </div>
                <span
                  className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                    activeTab === "compares"
                      ? "bg-purple-100 text-purple-900 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                      : "bg-surface-elevated text-text-muted border border-border"
                  }`}
                >
                  {comparisons.length}
                </span>
              </button>
            </nav>
          </div>

          {/* Quick Shortcuts */}
          <div className="space-y-1 pt-3 border-t border-border">
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted px-3.5 py-1">
              Quick Actions
            </div>
            <div className="space-y-1">
              <Link
                href="/evaluations/new"
                className="flex items-center justify-between px-3.5 py-2 text-xs font-semibold text-text-muted hover:text-text hover:bg-surface-elevated rounded-lg transition-colors group"
              >
                <span>+ Start New Review</span>
                <span className="text-text-muted group-hover:text-text">→</span>
              </Link>
              <Link
                href="/comparisons"
                className="flex items-center justify-between px-3.5 py-2 text-xs font-semibold text-text-muted hover:text-text hover:bg-surface-elevated rounded-lg transition-colors group"
              >
                <span>+ Compare Multi Roles</span>
                <span className="text-text-muted group-hover:text-text">→</span>
              </Link>
            </div>
          </div>
        </aside>

        {/* Right Main Content: 2-Column Grid */}
        <main className="flex-1 min-w-0 w-full">
          {activeTab === "bounties" ? (
            /* TAB: MY BOUNTIES */
            myBounties.length === 0 ? (
              <div className="p-12 text-center border border-border bg-surface rounded-xl space-y-4 shadow-xs">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-text">No personal bounties yet</h3>
                  <p className="text-xs text-text-muted max-w-sm mx-auto">
                    Publish a Solana USDC bounty escrow or evaluate your CV for an active bounty to see it listed here.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <Link href="/bounties">
                    <span className="inline-flex items-center justify-center px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors">
                      Explore Bounties →
                    </span>
                  </Link>
                  <Link href="/bounties/new">
                    <span className="inline-flex items-center justify-center px-4 py-2 bg-surface-elevated border border-border text-text text-xs font-semibold rounded-lg transition-colors">
                      + Post USDC Bounty
                    </span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {myBounties.map((b) => (
                  <div
                    key={b.id}
                    className="p-4 sm:p-5 bg-surface border border-border rounded-xl hover:border-purple-500/50 transition-all flex flex-col justify-between gap-4 shadow-xs"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <BountyCompanyLogo
                            company={b.company}
                            logoUrl={b.companyLogoUrl}
                            size="md"
                          />
                          <div className="min-w-0">
                            <span className="text-[11px] font-mono text-purple-400 uppercase font-semibold block truncate">
                              {b.company}
                            </span>
                            <h3 className="text-sm font-bold text-text truncate">
                              {b.title}
                            </h3>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-surface-elevated border border-border text-[10px] font-mono text-purple-400 shrink-0">
                          {b.role === "published" ? "Publisher" : "Applicant"}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-text-muted">
                        <span>{b.rewardPerWinnerUsdc} USDC / winner</span>
                        <span>·</span>
                        <span>
                          {b.claimsCount} paid
                          {(b.approvedCount ?? 0) > 0 ? ` · ${b.approvedCount} approved` : ""}
                          {(b.pendingReviewCount ?? 0) > 0 ? ` · ${b.pendingReviewCount} in review` : ""}{" "}
                          / {b.maxWinners}
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-border flex items-center justify-between gap-3">
                      <span className="text-xs font-mono text-text-secondary">
                        {b.role === "published"
                          ? `Min ${b.minScore}/100`
                          : b.overallScore !== null && b.overallScore !== undefined
                          ? `Score: ${b.overallScore}/100 (${b.submissionStatus ?? "evaluated"})`
                          : "Evaluated"}
                      </span>

                      <Link
                        href={
                          b.role === "published"
                            ? `/bounties/${b.id}/review`
                            : `/bounties/${b.id}/result${b.evaluationId ? `?evalId=${encodeURIComponent(b.evaluationId)}` : ""}`
                        }
                        className="px-3 py-1.5 bg-surface-elevated hover:border-purple-500/40 border border-border text-xs font-semibold text-purple-400 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        {b.role === "published" ? "Review Candidates →" : "View Result →"}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : activeTab === "reviews" ? (
            /* TAB: MY REVIEWS */
            evaluations.length === 0 ? (
              <div className="p-12 text-center border border-border bg-surface rounded-xl space-y-4 shadow-xs">
                <div className="w-12 h-12 mx-auto rounded-full bg-surface-elevated border border-border flex items-center justify-center text-text-muted">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-text">No CV reviews found</h3>
                  <p className="text-xs text-text-muted max-w-sm mx-auto">
                    Submit your CV to simulate a real hiring committee with 6 AI personas.
                  </p>
                </div>
                <Link
                  href="/evaluations/new"
                  className="inline-flex items-center justify-center px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
                >
                  Start Your First Review
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {evaluations.map((ev) => {
                  const isCompleted = ev.status === "completed";
                  const isProcessing = ev.status === "processing" || ev.status === "queued";
                  const dateStr = new Date(ev.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const targetHref = isCompleted
                    ? `/evaluations/${ev.id}/report`
                    : `/evaluations/${ev.id}/progress`;

                  return (
                    <div
                      key={ev.id}
                      className="p-4 sm:p-5 bg-surface border border-border rounded-xl hover:border-purple-500/50 transition-all flex flex-col justify-between gap-4 group shadow-xs"
                    >
                      <div className="space-y-2">
                        {/* Card Header */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono text-text-muted font-semibold">
                            #{ev.id.slice(0, 8)}
                          </span>
                          <span className="text-[11px] font-mono capitalize">
                            {isCompleted ? (
                              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Completed
                              </span>
                            ) : isProcessing ? (
                              <span className="inline-flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-semibold animate-pulse">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                In Progress
                              </span>
                            ) : (
                              <span className="text-red-500 dark:text-red-400">{ev.status}</span>
                            )}
                          </span>
                        </div>

                        {/* Title / Verdict */}
                        <h3 className="text-sm font-bold text-text group-hover:text-purple-600 dark:group-hover:text-purple-300 transition-colors line-clamp-1">
                          {ev.verdict ? ev.verdict : "AI Committee Simulation"}
                        </h3>

                        {/* Metadata */}
                        <div className="flex items-center gap-2 text-[11px] text-text-muted font-mono">
                          <span className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border capitalize text-text">
                            {ev.tone.replace("_", " ")}
                          </span>
                          <span>•</span>
                          <span>{dateStr}</span>
                        </div>
                      </div>

                      {/* Card Bottom */}
                      <div className="pt-3 border-t border-border flex items-center justify-between gap-3">
                        {ev.overallScore !== null ? (
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-lg font-bold font-mono text-purple-600 dark:text-purple-400">
                              {ev.overallScore}
                            </span>
                            <span className="text-[11px] font-mono text-text-muted">
                              / 100
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-text-muted font-mono">
                            Pending score
                          </span>
                        )}

                        <Link
                          href={targetHref}
                          className="px-3 py-1.5 bg-surface-elevated hover:bg-surface-elevated/80 border border-border text-xs font-semibold text-text rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        >
                          <span>{isCompleted ? "View Report" : "View Live"}</span>
                          <span className="text-text-muted">→</span>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* TAB: ROLE COMPARES */
            comparisons.length === 0 ? (
              <div className="p-12 text-center border border-border bg-surface rounded-xl space-y-4 shadow-xs">
                <div className="w-12 h-12 mx-auto rounded-full bg-surface-elevated border border-border flex items-center justify-center text-text-muted">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-text">No role comparisons yet</h3>
                  <p className="text-xs text-text-muted max-w-sm mx-auto">
                    Compare your CV against multiple industry benchmarks from top tech companies.
                  </p>
                </div>
                <Link
                  href="/comparisons"
                  className="inline-flex items-center justify-center px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
                >
                  Start Role Comparison
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {comparisons.map((comp) => {
                  const dateStr = new Date(comp.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  });

                  return (
                    <div
                      key={comp.id}
                      className="p-4 sm:p-5 bg-surface border border-border rounded-xl hover:border-purple-500/50 transition-all flex flex-col justify-between gap-4 group shadow-xs"
                    >
                      <div className="space-y-2.5">
                        {/* Role Compare Title and Count */}
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-bold text-text group-hover:text-purple-600 dark:group-hover:text-purple-300 transition-colors line-clamp-1">
                            {comp.winningRoleTitle}
                          </h3>
                          <span className="text-[11px] font-mono text-text-muted shrink-0">
                            {comp.rolesCount} Roles
                          </span>
                        </div>

                        {/* Simple Companies Tags */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {Array.from(new Set(comp.roles.map((r) => r.company).filter(Boolean))).map((company, idx) => {
                            const logoUrl = getCompanyLogoUrl(company);
                            return (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-elevated border border-border text-[11px] text-text font-medium"
                              >
                                {logoUrl && (
                                  <span className="w-3.5 h-3.5 p-0.5 rounded bg-white flex items-center justify-center shrink-0 shadow-2xs">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={logoUrl}
                                      alt={company}
                                      className="w-full h-full object-contain"
                                    />
                                  </span>
                                )}
                                <span>{company}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Card Bottom */}
                      <div className="pt-3 border-t border-border flex items-center justify-between gap-3">
                        <span className="text-xs text-text-muted font-mono">
                          {dateStr}
                        </span>

                        <button
                          onClick={() => handleOpenComparison(comp)}
                          className="px-3 py-1.5 bg-surface-elevated hover:bg-surface-elevated/80 border border-border text-xs font-semibold text-text rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <span>View Report</span>
                          <span className="text-text-muted">→</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </main>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ErrorPopup } from "@/components/ui/error-popup";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { apiFetch } from "@/lib/client/api";
import { getPendingCv, clearPendingCv } from "@/lib/client/pending-cv";
import {
  FAMOUS_ROLE_PRESETS,
  isFamousPresetJd,
  type FamousRolePreset,
  type PresetCategory,
} from "@/lib/job-descriptions/presets";
import { getCompanyLogo } from "@/components/ui/company-logo";
import { preloadAgentAvatars } from "@/components/ui/avatar";
import { useSession } from "@/lib/auth/auth-client";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";
import { BountyCompanyLogo } from "@/components/solana/bounty-company-logo";
import {
  captureScoutReferralFromSearch,
  getStoredScoutReferral,
} from "@/lib/solana/scout-referral";

type BenchmarkPreset = FamousRolePreset;

interface UploadDocumentResponse {
  id?: string;
  cvVersionId?: string | null;
  cvVersion?: { id: string } | null;
  document?: {
    id?: string;
    cvVersionId?: string | null;
    cvVersion?: { id: string } | null;
  } | null;
}

interface CreateJdResponse {
  id?: string;
  jobDescription?: { id: string };
  data?: { id: string };
}

interface CreateEvaluationResponse {
  id?: string;
  evaluationId?: string;
  evaluation?: { id: string };
}

const BENCHMARKS: FamousRolePreset[] = FAMOUS_ROLE_PRESETS;

interface RecentJobPreset {
  id: string;
  company: string;
  role: string;
  summary: string;
  description: string;
}

export interface ActiveBountyTarget {
  id: string;
  jobDescriptionId: string;
  title: string;
  company: string;
  companyLogoUrl?: string | null;
  minScore: number;
  minStreak?: number;
  rewardPerWinnerUsdc: number;
  candidate90Usdc?: number;
  scout10Usdc?: number;
  stakePercent?: number;
  stakePerCandidateUsdc?: number;
  slashedPoolUsdc?: number;
  proRataBonusUsdc?: number;
  rawText: string;
  availableSlots?: number;
}

interface CandidateReputationInfo {
  effectiveStreak: number;
  fraudFlags: number;
  totalEarnedUsdc: number;
  isFresh: boolean;
  isZeroStakeVip: boolean;
  daysUntilDecay: number | null;
}

export interface NewEvaluationClientProps {
  initialBounty?: ActiveBountyTarget | null;
  initialRole?: string;
  initialRestriction?: { reason: string; details: string } | null;
  initialScoutReferrer?: string | null;
}

export function NewEvaluationClient({
  initialBounty = null,
  initialRole = "",
  initialRestriction = null,
  initialScoutReferrer = null,
}: NewEvaluationClientProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { publicKey, openConnectModal, signAndSubmitTx } = useSolanaWallet();

  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvDragOver, setCvDragOver] = useState(false);
  const [company, setCompany] = useState(initialBounty?.company ?? "");
  const [jobTitle, setJobTitle] = useState(
    initialBounty?.title ?? initialRole ?? ""
  );
  const [jobDescriptionText, setJobDescriptionText] = useState(
    initialBounty?.rawText ?? ""
  );
  const [tone, setTone] = useState<"strict" | "friendly" | "brutal_roast">(
    initialBounty ? "brutal_roast" : "strict"
  );
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [benchmarkCategory, setBenchmarkCategory] = useState<"all" | PresetCategory>("all");
  const [showAllBenchmarks, setShowAllBenchmarks] = useState(false);
  const [recentJobs, setRecentJobs] = useState<RecentJobPreset[]>([]);
  const [activeBounty, setActiveBounty] = useState<ActiveBountyTarget | null>(
    initialBounty
  );
  const [candidateReputation, setCandidateReputation] = useState<CandidateReputationInfo | null>(null);
  const [scoutReferrer, setScoutReferrer] = useState<string | null>(
    initialScoutReferrer
  );
  const [bountyRestriction, setBountyRestriction] = useState<{
    reason: string;
    details: string;
  } | null>(initialRestriction);

  useEffect(() => {
    async function syncBountyWalletContext() {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const bountyId = params.get("bountyId") ?? initialBounty?.id ?? null;
      const ids = initialBounty
        ? [initialBounty.id, initialBounty.jobDescriptionId, ...(bountyId ? [bountyId] : [])]
        : bountyId
        ? [bountyId]
        : [];
      captureScoutReferralFromSearch(params, ids);
      if (ids.length > 0) {
        const stored = getStoredScoutReferral(ids, publicKey);
        if (stored) setScoutReferrer(stored);
      }

      if (!bountyId) return;

      // Fast path when initialBounty came straight from Server Component SSR:
      // only check connected wallet reputation without scanning all Devnet bounties
      if (initialBounty) {
        if (!publicKey) return;
        try {
          const walletRes = await apiFetch<{
            onChainReputation?: CandidateReputationInfo | null;
          }>(`/api/solana/wallet?wallet=${encodeURIComponent(publicKey)}`);
          setCandidateReputation(walletRes?.onChainReputation ?? null);
        } catch {
          // Optional wallet reputation preview lookup
        }
        return;
      }

      try {
        const query = publicKey ? `?wallet=${encodeURIComponent(publicKey)}` : "";
        const res = await apiFetch<{
          bounties?: ActiveBountyTarget[];
          myRestrictions?: Array<{ bountyId: string; reason: string; details: string }>;
          candidateReputation?: CandidateReputationInfo | null;
        }>(`/api/solana/bounties${query}`);
        setCandidateReputation(res?.candidateReputation ?? null);
        const match = res?.bounties?.find(
          (b) => b.id === bountyId || b.jobDescriptionId === bountyId
        );
        if (match) {
          setActiveBounty(match);
          setCompany(match.company);
          setJobTitle(match.title);
          setJobDescriptionText(match.rawText);
          setTone("brutal_roast");
          const rest = res?.myRestrictions?.find((r) => r.bountyId === match.id);
          setBountyRestriction(rest ? { reason: rest.reason, details: rest.details } : null);
          const matchIds = [match.id, match.jobDescriptionId, bountyId];
          captureScoutReferralFromSearch(window.location.search, matchIds);
          setScoutReferrer(getStoredScoutReferral(matchIds, publicKey));
        }
      } catch {
        // Ignore if unreachable
      }
    }
    void syncBountyWalletContext();
  }, [initialBounty, publicKey]);

  useEffect(() => {
    if (initialBounty) return;
    async function loadRecentJobs() {
      try {
        const res = await apiFetch<Array<{ id: string; company: string; roleTitle?: string; rawText: string }>>("/api/job-descriptions");
        if (res && Array.isArray(res) && res.length > 0) {
          const userOnly = res.filter(
            (j) =>
              !isFamousPresetJd({
                id: j.id,
                company: j.company,
                roleTitle: j.roleTitle,
                title: j.roleTitle,
                rawText: j.rawText,
              })
          );
          const seen = new Set<string>();
          const userJobs: RecentJobPreset[] = [];
          for (const j of userOnly) {
            const comp = (j.company || "").trim().toLowerCase();
            const role = (j.roleTitle || "").trim().toLowerCase();
            const dedupeKey = `${comp}:::${role}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            userJobs.push({
              id: `db-${j.id}`,
              company: j.company || "Custom Role",
              role: j.roleTitle || "Target Role",
              summary: j.rawText.length > 120 ? j.rawText.slice(0, 120) + "..." : j.rawText,
              description: j.rawText,
            });
          }
          setRecentJobs(userJobs.slice(0, 6));
        }
      } catch {
        // Leave empty if unable to fetch
      }
    }
    loadRecentJobs();
  }, [initialBounty]);

  useEffect(() => {
    preloadAgentAvatars();
  }, []);

  useEffect(() => {
    async function restorePendingCv() {
      try {
        const pending = await getPendingCv();
        if (pending && pending.file) {
          setCvFile(pending.file);
          if (pending.targetRole && !initialBounty) {
            setJobTitle((prev) => prev || pending.targetRole || "");
          }
          await clearPendingCv();
        }
      } catch (err) {
        console.warn("Could not restore pending CV from landing page:", err);
      }
    }

    restorePendingCv();
  }, [initialBounty]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSelectPreset = (preset: BenchmarkPreset) => {
    setSelectedPresetId(preset.id);
    setCompany(preset.name);
    setJobTitle(preset.role);
    setJobDescriptionText(preset.description);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCvDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setCvDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleCvFile(e.dataTransfer.files[0]);
    }
  };

  const handleCvFile = (file: File) => {
    const valid = file.name.endsWith(".pdf") || file.name.endsWith(".docx");
    if (!valid) {
      setErrorMessage("Please upload a PDF or DOCX file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("File exceeds 10MB limit.");
      return;
    }
    setErrorMessage(null);
    setCvFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      router.push("/auth?callbackUrl=/evaluations/new");
      return;
    }
    if (!cvFile) {
      setErrorMessage("Please upload your CV.");
      return;
    }
    if (!jobDescriptionText.trim() || jobDescriptionText.trim().length < 50) {
      setErrorMessage("Please provide a job description (at least 50 characters).");
      return;
    }
    if (activeBounty && !publicKey) {
      openConnectModal();
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const cvFormData = new FormData();
      cvFormData.append("file", cvFile);
      cvFormData.append("type", "cv");

      const effectiveReferrer = activeBounty
        ? scoutReferrer ??
          getStoredScoutReferral([activeBounty.id, activeBounty.jobDescriptionId], publicKey)
        : null;

      // Run independent preparations in parallel so CV extraction/storage never blocks Solana or JD setup
      const uploadPromise = apiFetch<UploadDocumentResponse>("/api/documents", {
        method: "POST",
        body: cvFormData,
      });

      const stakePreparePromise =
        activeBounty && publicKey
          ? apiFetch<{
              serializedTxBase64: string;
              stakeUsdc: number;
              isZeroStakeVip?: boolean;
            }>(`/api/solana/bounties/${activeBounty.id}/stake`, {
              method: "POST",
              body: JSON.stringify({
                walletAddress: publicKey,
                referrerWallet: effectiveReferrer,
              }),
            })
          : Promise.resolve(null);

      const jdPromise = activeBounty?.jobDescriptionId
        ? Promise.resolve<CreateJdResponse | null>(null)
        : apiFetch<CreateJdResponse>("/api/job-descriptions", {
            method: "POST",
            body: JSON.stringify({
              title: jobTitle.trim() || "Target Role",
              company: company.trim() || undefined,
              rawText: jobDescriptionText.trim(),
            }),
          });

      const [cvDocRes, preparedStake, jdRes] = await Promise.all([
        uploadPromise,
        stakePreparePromise,
        jdPromise,
      ]);

      let cvVersionId =
        cvDocRes?.cvVersionId ||
        cvDocRes?.cvVersion?.id ||
        cvDocRes?.document?.cvVersionId ||
        cvDocRes?.document?.cvVersion?.id;

      if (!cvVersionId && (cvDocRes?.id || cvDocRes?.document?.id)) {
        const docId = cvDocRes?.id || cvDocRes?.document?.id;
        try {
          const versions = await apiFetch<Array<{ id: string }>>(
            `/api/cv/versions?documentId=${docId}`
          );
          if (versions && versions.length > 0) {
            cvVersionId = versions[0].id;
          }
        } catch {}
      }

      if (!cvVersionId) {
        throw new Error("Could not process CV version. Please try uploading again.");
      }

      let stakeTxSignature: string | undefined;
      if (preparedStake) {
        stakeTxSignature = await signAndSubmitTx(preparedStake.serializedTxBase64);
      }

      const jobDescriptionId =
        activeBounty?.jobDescriptionId ||
        jdRes?.id ||
        jdRes?.jobDescription?.id ||
        jdRes?.data?.id;

      if (!jobDescriptionId) {
        throw new Error("Could not save job description. Please try again.");
      }

      // Enforce Very Strict review mode for bounties
      const effectiveTone = activeBounty ? "brutal_roast" : tone;

      // Launch Evaluation (verifies Conviction Stake PDA + instant duplicate & heuristic anti-fraud gates)
      const evalRes = await apiFetch<CreateEvaluationResponse>("/api/evaluations", {
        method: "POST",
        body: JSON.stringify({
          cvVersionId,
          jobDescriptionId,
          tone: effectiveTone,
          ...(activeBounty && publicKey
            ? {
                walletAddress: publicKey,
                stakeTxSignature,
                ...(effectiveReferrer ? { referrerWallet: effectiveReferrer } : {}),
              }
            : {}),
        }),
      });

      const evaluationId =
        evalRes?.evaluationId ||
        evalRes?.evaluation?.id ||
        evalRes?.id;

      if (!evaluationId) {
        throw new Error("Failed to queue evaluation. Please try again.");
      }

      router.push(`/evaluations/${evaluationId}/progress`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to initiate evaluation";
      if (
        msg.toLowerCase().includes("authentication required") ||
        msg.toLowerCase().includes("unauthorized") ||
        msg.toLowerCase().includes("unauthenticated")
      ) {
        router.push("/auth?callbackUrl=/evaluations/new");
        return;
      }
      setErrorMessage(msg);
      setIsSubmitting(false);
    }
  };

  if (isSubmitting) {
    return <FullPageLoading />;
  }

  const isBountyLocked = Boolean(activeBounty);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text">New Review</h1>
          {isBountyLocked && (
            <Badge variant="purple" size="sm">
              Bounty Strict Mode
            </Badge>
          )}
        </div>
        <Badge variant="neutral" size="sm">PDF or DOCX</Badge>
      </div>

      <ErrorPopup
        title="Review Notice"
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />

      {bountyRestriction && activeBounty && (
        <div className="rounded-xl border border-border bg-surface p-5 space-y-1.5">
          <div className="flex items-center gap-3">
            <BountyCompanyLogo
              company={activeBounty.company}
              logoUrl={activeBounty.companyLogoUrl}
              size="sm"
            />
            <h3 className="text-sm font-bold text-purple-400">
              Restricted from Bounty ({bountyRestriction.reason.replace(/_/g, " ")})
            </h3>
          </div>
          <p className="text-xs sm:text-sm text-text leading-relaxed">
            {bountyRestriction.details} You cannot submit or claim on{" "}
            <strong>{activeBounty.title}</strong>.
          </p>
        </div>
      )}

      {activeBounty && !bountyRestriction && (() => {
        const stakePct = activeBounty.stakePercent ?? 10;
        const standardStakeUsdc =
          activeBounty.stakePerCandidateUsdc ??
          (activeBounty.rewardPerWinnerUsdc * stakePct) / 100;
        const isZeroStakeVip = Boolean(candidateReputation?.isZeroStakeVip);
        const requiredStreak = activeBounty.minStreak ?? 0;
        const activeStreak = candidateReputation?.effectiveStreak ?? 0;
        const missingMinStreak =
          requiredStreak > 0 &&
          (!candidateReputation ||
            candidateReputation.fraudFlags > 0 ||
            !candidateReputation.isFresh ||
            activeStreak < requiredStreak);
        const slashedBonus = activeBounty.proRataBonusUsdc ?? 0;
        const activeReferrer =
          scoutReferrer ??
          getStoredScoutReferral([activeBounty.id, activeBounty.jobDescriptionId], publicKey);

        return (
          <div className="rounded-xl border border-border bg-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <BountyCompanyLogo
                company={activeBounty.company}
                logoUrl={activeBounty.companyLogoUrl}
                size="md"
              />
              <div className="space-y-1.5 min-w-0">
                <div className="text-sm font-bold text-purple-400">
                  Solana USDC Bounty Mode · {activeBounty.rewardPerWinnerUsdc} USDC Reward ·{" "}
                  {isZeroStakeVip
                    ? "0 USDC Stake (Verified Streak Perk)"
                    : `${standardStakeUsdc} USDC Stake (${stakePct}%)`}
                </div>
                <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                  Targeting <strong className="text-text">{activeBounty.title}</strong> at{" "}
                  <strong className="text-text">{activeBounty.company}</strong>.{" "}
                  {isZeroStakeVip
                    ? "Your 2+ active verified streak waives the Conviction Stake deposit cleanly while still earning "
                    : `Locking ${standardStakeUsdc} USDC gets refunded 100% + `}
                  {slashedBonus > 0
                    ? `+${slashedBonus.toFixed(2)} USDC slashed spam yield `
                    : "slashed spam yield "}
                  upon approval ({activeBounty.minScore}/100+ bar). Duplicate or fake resumes
                  permanently reset verified streak &amp; slash stake.
                </p>
                {activeReferrer && (
                  <p className="text-xs font-mono text-purple-400">
                    Scout Split Active: Referred by {activeReferrer.slice(0, 6)}...
                    {activeReferrer.slice(-4)} (90% Candidate / 10% Scout on reward).
                  </p>
                )}
                {missingMinStreak && (
                  <p className="text-xs font-mono text-red-400">
                    Minimum Streak Gate: This bounty requires {requiredStreak}+ active streak (30d fresh, 0 fraud flags). Your active streak is {activeStreak}.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!publicKey && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={openConnectModal}
                >
                  Connect Wallet to Stake
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setActiveBounty(null);
                  setBountyRestriction(null);
                }}
              >
                Detach Bounty
              </Button>
            </div>
          </div>
        );
      })()}

      {/* Main Review Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: CV Upload (and Tone Chooser when not in Bounty Mode) */}
          <div className="lg:col-span-5 space-y-6">
            <Card className="bg-surface border-border">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-base font-bold text-text">
                  1. Upload CV
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setCvDragOver(true);
                  }}
                  onDragLeave={() => setCvDragOver(false)}
                  onDrop={handleCvDrop}
                  onClick={() => document.getElementById("cv-file-input")?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                    cvDragOver
                      ? "border-purple-500 bg-purple-950/20"
                      : cvFile
                      ? "border-purple-400 bg-purple-950/10"
                      : "border-border hover:border-purple-500/50 bg-surface-elevated/40"
                  }`}
                >
                  <input
                    id="cv-file-input"
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleCvFile(e.target.files[0]);
                      }
                    }}
                  />

                  {cvFile ? (
                    <div className="space-y-1">
                      <p className="font-bold text-sm text-text truncate max-w-xs">
                        {cvFile.name}
                      </p>
                      <p className="text-xs text-purple-600 dark:text-purple-300 font-mono">
                        {(cvFile.size / 1024).toFixed(1)} KB · Click to replace
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="font-semibold text-sm text-text">
                        Drop CV here or click to browse
                      </p>
                      <p className="text-xs text-text-muted">
                        PDF or DOCX up to 10MB
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Tone Selector — completely hidden for bounties where Strict Mode is mandatory */}
            {!isBountyLocked && (
              <Card className="bg-surface border-border">
                <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base font-bold text-text">
                    2. Review Style
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: "brutal_roast" as const, label: "Roast" },
                      { id: "strict" as const, label: "Strict" },
                      { id: "friendly" as const, label: "Coach" },
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTone(t.id)}
                        className={`py-2.5 px-3 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
                          tone === t.id
                            ? "border-purple-500 bg-purple-600 text-white shadow-sm"
                            : "border-border bg-surface-elevated text-text-secondary hover:text-text"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: Target Role Criteria (non-editable when entering a bounty) */}
          <div className="lg:col-span-7">
            <Card className="bg-surface border-border h-full flex flex-col justify-between">
              <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base font-bold text-text">
                  {isBountyLocked ? "2. Target Role" : "3. Target Role"}
                </CardTitle>
                {isBountyLocked && (
                  <span className="px-2.5 py-0.5 text-[11px] font-mono rounded-md bg-surface-elevated border border-border text-purple-400">
                    Locked for Bounty
                  </span>
                )}
              </CardHeader>
              <CardContent className="pt-4 space-y-4 flex-1 flex flex-col">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Company"
                    placeholder="e.g. Google, Amazon, CBE"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    disabled={isBountyLocked}
                    readOnly={isBountyLocked}
                    className={isBountyLocked ? "opacity-80 cursor-not-allowed" : undefined}
                  />
                  <Input
                    label="Role Title"
                    placeholder="e.g. Senior Software Engineer"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    disabled={isBountyLocked}
                    readOnly={isBountyLocked}
                    className={isBountyLocked ? "opacity-80 cursor-not-allowed" : undefined}
                  />
                </div>

                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-text">
                    Job Description *
                  </label>
                  <Textarea
                    placeholder="Paste job description requirements or pick a company below..."
                    rows={9}
                    value={jobDescriptionText}
                    onChange={(e) => {
                      setJobDescriptionText(e.target.value);
                      setSelectedPresetId(null);
                    }}
                    disabled={isBountyLocked}
                    readOnly={isBountyLocked}
                    className={`text-sm flex-1 min-h-[180px] ${
                      isBountyLocked ? "opacity-85 cursor-not-allowed select-text" : ""
                    }`}
                    required
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-2">
          {activeBounty && (
            <span className="text-xs font-mono text-text-muted">
              {candidateReputation?.isZeroStakeVip
                ? "0 USDC Stake (Verified Streak Perk) · streak waives USDC lock"
                : `${(
                    activeBounty.stakePerCandidateUsdc ??
                    (activeBounty.rewardPerWinnerUsdc * (activeBounty.stakePercent ?? 10)) / 100
                  ).toFixed(2)} USDC stake → get stake back + slashed spam yield on approval`}
            </span>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isSubmitting}
            disabled={!cvFile || jobDescriptionText.trim().length < 50}
            className="w-full sm:w-auto min-w-[220px] h-11 text-sm font-bold"
          >
            {activeBounty
              ? !publicKey
                ? "Connect Wallet & Start Review →"
                : candidateReputation?.isZeroStakeVip
                ? "Start Review (0 USDC Streak Perk) →"
                : `Lock ${(
                    activeBounty.stakePerCandidateUsdc ??
                    (activeBounty.rewardPerWinnerUsdc * (activeBounty.stakePercent ?? 10)) / 100
                  ).toFixed(2)} USDC Stake & Start Review →`
              : "Start Review →"}
          </Button>
        </div>
      </form>

      {/* Benchmark Companies & Recent Roles (only in standard non-bounty mode) */}
      {!isBountyLocked && (() => {
        const filteredBenchmarks = BENCHMARKS.filter(
          (b) => benchmarkCategory === "all" || b.category === benchmarkCategory
        );
        const displayedBenchmarks = showAllBenchmarks
          ? filteredBenchmarks
          : filteredBenchmarks.slice(0, 3);

        return (
          <div className="pt-3 border-t border-border space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-xl font-bold text-text tracking-tight">
                Target Famous Tech Benchmarks
              </h2>
              {selectedPresetId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPresetId(null);
                    setCompany("");
                    setJobTitle("");
                    setJobDescriptionText("");
                  }}
                  className="text-xs text-text-muted hover:text-text underline font-mono cursor-pointer self-start sm:self-auto"
                >
                  Clear Preset
                </button>
              )}
            </div>

            {/* Category Filter Tabs (Simple, neutral, no glow) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-mono">
              {[
                { id: "all", label: `All (${BENCHMARKS.length})` },
                { id: "big_tech", label: "Big Tech" },
                { id: "ai", label: "AI" },
                { id: "cyber", label: "Cyber" },
                { id: "blockchain", label: "Blockchain" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setBenchmarkCategory(tab.id as "all" | PresetCategory);
                    setShowAllBenchmarks(false);
                  }}
                  className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer shrink-0 ${
                    benchmarkCategory === tab.id
                      ? "bg-surface-elevated text-text font-semibold border border-border shadow-xs"
                      : "text-text-muted hover:text-text hover:bg-surface-elevated border border-transparent"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {displayedBenchmarks.map((b) => {
                const isSelected = selectedPresetId === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleSelectPreset(b)}
                    className={`p-5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                      isSelected
                        ? "border-purple-500 bg-purple-50 dark:bg-purple-950/60 shadow-lg ring-1 ring-purple-500"
                        : "border-border bg-surface hover:border-zinc-400 dark:hover:border-zinc-700 hover:bg-surface-elevated"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-lg bg-surface-elevated border border-border shrink-0 flex items-center justify-center">
                        {getCompanyLogo(b.id)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-base text-text truncate">{b.name}</span>
                          {isSelected && (
                            <Badge variant="purple" size="sm">Selected</Badge>
                          )}
                        </div>
                        <div className="text-xs text-purple-600 dark:text-purple-300 font-mono truncate font-semibold">{b.role}</div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-text">
                        {b.question}
                      </p>
                      <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">
                        {b.summary}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px] font-mono text-text-muted">
                      <span>Load Criteria</span>
                      <span>→</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {filteredBenchmarks.length > 3 && (
              <div className="pt-1 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllBenchmarks(!showAllBenchmarks)}
                  className="text-xs text-text-muted hover:text-text py-1.5 px-3.5 rounded-lg border border-border hover:border-border/80 bg-surface-elevated transition-colors cursor-pointer font-mono"
                >
                  {showAllBenchmarks ? "Show less" : `See more (${filteredBenchmarks.length - 3})`}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Recently Reviewed Roles (only in standard non-bounty mode) */}
      {!isBountyLocked && recentJobs.length > 0 && (
        <div className="pt-8 border-t border-border space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-text">
                Recently Reviewed Roles
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                Quickly re-run evaluations against roles you recently reviewed or benchmarked.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recentJobs.map((rj) => {
              const isSelected = selectedPresetId === rj.id;
              return (
                <button
                  key={rj.id}
                  type="button"
                  onClick={() => {
                    setSelectedPresetId(rj.id);
                    setCompany(rj.company);
                    setJobTitle(rj.role);
                    setJobDescriptionText(rj.description);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className={`p-5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                    isSelected
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-950/60 shadow-lg ring-2 ring-purple-500"
                      : "border-border bg-surface hover:border-purple-500/50 hover:bg-surface-elevated"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-surface-elevated border border-border shrink-0 flex items-center justify-center">
                      {getCompanyLogo(rj.company.toLowerCase()) || (
                        <div className="w-6 h-6 rounded bg-purple-100 dark:bg-purple-900/60 border border-purple-300 dark:border-purple-500/40 flex items-center justify-center text-xs font-bold font-mono text-purple-700 dark:text-purple-300">
                          {rj.company.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-base text-text truncate">{rj.company}</span>
                        {isSelected && (
                          <Badge variant="purple" size="sm">Selected</Badge>
                        )}
                      </div>
                      <div className="text-xs text-purple-600 dark:text-purple-300 font-mono truncate font-semibold">{rj.role}</div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">
                      {rj.summary}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px] font-mono text-purple-600 dark:text-purple-300">
                    <span>Load Recent Role</span>
                    <span>→</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

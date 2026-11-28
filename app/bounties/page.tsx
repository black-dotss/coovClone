"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ErrorPopup } from "@/components/ui/error-popup";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { apiFetch } from "@/lib/client/api";
import { executeBountyClaimFlow } from "@/lib/solana/client-claim";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";
import { BountyCompanyLogo } from "@/components/solana/bounty-company-logo";

interface BountyItem {
  id: string;
  recruiterUserId: string;
  recruiterWallet: string;
  jobDescriptionId: string;
  title: string;
  company: string;
  companyLogoUrl?: string | null;
  usdcMint: string;
  escrowPdaAddress: string;
  vaultAddress: string;
  createTxSignature: string | null;
  refundTxSignature: string | null;
  minScore: number;
  rewardPerWinnerUsdc: number;
  totalPoolUsdc: number;
  maxWinners: number;
  claimsCount: number;
  pendingReviewCount: number;
  approvedCount: number;
  occupiedSlots: number;
  availableSlots: number;
  status: string;
  isExpired: boolean;
  expiresAt: string;
  rawText: string;
  escrowUrl: string;
  txUrl: string | null;
}

interface CandidateEvalSummary {
  id: string;
  jobDescriptionId: string;
  status: string;
  overallScore: number | null;
  candidateWallet: string | null;
  evalTxSignature: string | null;
}

interface CandidateClaimSummary {
  bountyId: string;
  claimTxSignature: string;
  amountMicros: string;
  candidateWallet: string;
}

interface CandidateSubmissionSummary {
  id: string;
  bountyId: string;
  evaluationId: string;
  candidateWallet: string | null;
  resumeHash: string;
  fakeDetectorStatus: string;
  fakeDetectorScore: number | null;
  reviewStatus: string;
  slotReservedAt: string | null;
  reviewDeadlineAt: string | null;
  recruiterNotes: string | null;
  isReviewExpired: boolean;
  remainingReviewLabel: string | null;
}

interface RestrictionSummary {
  bountyId: string;
  reason: string;
  details: string;
  createdAt: string;
}

interface BountiesApiResponse {
  cluster: string;
  currentUserId: string | null;
  bounties: BountyItem[];
  myEvaluations: CandidateEvalSummary[];
  myClaims: CandidateClaimSummary[];
  mySubmissions?: CandidateSubmissionSummary[];
  myRestrictions?: RestrictionSummary[];
}

export default function BountiesPage() {
  const router = useRouter();
  const { publicKey, openConnectModal, signAndSubmitTx, clusterLabel } =
    useSolanaWallet();

  const [data, setData] = useState<BountiesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [navigatingToNew, setNavigatingToNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return new URLSearchParams(window.location.search).get("created") === "1"
        ? "USDC Bounty Escrow funded and live on Solana Devnet."
        : null;
    } catch {
      return null;
    }
  });
  const [evalArrival] = useState<{ fromEval: string; bountyId: string } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const p = new URLSearchParams(window.location.search);
      const fromEval = p.get("fromEval");
      const bountyId = p.get("bountyId");
      return fromEval && bountyId ? { fromEval, bountyId } : null;
    } catch {
      return null;
    }
  });
  const [busyBountyId, setBusyBountyId] = useState<string | null>(null);

  const loadBounties = useCallback(async () => {
    setLoading(true);
    try {
      const query = publicKey ? `?wallet=${encodeURIComponent(publicKey)}` : "";
      const res = await apiFetch<BountiesApiResponse>(`/api/solana/bounties${query}`);
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load Solana USDC bounties."
      );
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      (window.location.search.includes("created=1") ||
        window.location.search.includes("fromEval="))
    ) {
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch {}
    }

    let active = true;
    (async () => {
      try {
        const query = publicKey ? `?wallet=${encodeURIComponent(publicKey)}` : "";
        const res = await apiFetch<BountiesApiResponse>(`/api/solana/bounties${query}`);
        if (active) setData(res);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load Solana USDC bounties."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [publicKey]);

  const showError = (err: unknown, fallback: string) => {
    setError(err instanceof Error ? err.message : fallback);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleOpenNewBounty = () => {
    setNavigatingToNew(true);
    router.push("/bounties/new");
  };

  const handleSubmitSlot = async (bounty: BountyItem, evalId: string) => {
    setBusyBountyId(bounty.id);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/solana/bounties/${bounty.id}/submit`, {
        method: "POST",
        body: JSON.stringify({
          evaluationId: evalId,
          ...(publicKey ? { walletAddress: publicKey } : {}),
        }),
      });
      setNotice(
        "Winner slot reserved in pending_review! Payout unlocks upon recruiter approval or after the 24h review window expires."
      );
      await loadBounties();
    } catch (err) {
      showError(err, "Failed to reserve bounty review slot.");
    } finally {
      setBusyBountyId(null);
    }
  };

  const handleClaim = async (
    bounty: BountyItem,
    evalId: string,
    isEvalAnchored: boolean
  ) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setBusyBountyId(bounty.id);
    setError(null);
    setNotice(null);
    try {
      const confirmed = await executeBountyClaimFlow({
        bountyId: bounty.id,
        evaluationId: evalId,
        walletAddress: publicKey,
        isEvalAnchored,
        signAndSubmitTx,
      });

      setNotice(
        `Claimed ${confirmed.amountPaidUsdc} USDC directly from escrow PDA into your wallet!`
      );
      await loadBounties();
    } catch (err) {
      showError(err, "Failed to claim USDC bounty.");
    } finally {
      setBusyBountyId(null);
    }
  };

  const handleRefund = async (bounty: BountyItem) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setBusyBountyId(bounty.id);
    setError(null);
    setNotice(null);
    try {
      const prepared = await apiFetch<{ serializedTxBase64: string }>(
        `/api/solana/bounties/${bounty.id}/refund`,
        {
          method: "POST",
          body: JSON.stringify({ walletAddress: publicKey }),
        }
      );

      const txSignature = await signAndSubmitTx(prepared.serializedTxBase64);

      await apiFetch(`/api/solana/bounties/${bounty.id}/refund`, {
        method: "PATCH",
        body: JSON.stringify({ txSignature }),
      });

      setNotice("Expired escrow USDC refunded back to your wallet.");
      await loadBounties();
    } catch (err) {
      showError(err, "Failed to withdraw expired escrow.");
    } finally {
      setBusyBountyId(null);
    }
  };

  if (navigatingToNew || (loading && !data)) {
    return <FullPageLoading />;
  }

  const arrivalBounty =
    evalArrival && data ? data.bounties.find((b) => b.id === evalArrival.bountyId) : null;
  const arrivalEval =
    evalArrival && data
      ? data.myEvaluations.find((e) => e.id === evalArrival.fromEval)
      : null;
  const arrivalSub =
    evalArrival && data
      ? data.mySubmissions?.find((s) => s.evaluationId === evalArrival.fromEval)
      : null;
  const arrivalRestriction =
    evalArrival && data
      ? data.myRestrictions?.find((r) => r.bountyId === evalArrival.bountyId)
      : null;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      {/* Header with 2 clean action buttons only */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text">
            Hiring Bounties
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary">
            USDC bounty escrows with verified CV screening on Solana {clusterLabel}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <Link href="/profile?tab=solana">
            <Button variant="outline" size="md">
              On-Chain & SBT
            </Button>
          </Link>
          <Button variant="primary" size="md" onClick={handleOpenNewBounty}>
            + Post USDC Bounty Escrow
          </Button>
        </div>
      </div>

      {/* Direct Return Banner after Bounty CV Evaluation (Neutral surface + purple text only) */}
      {arrivalBounty && arrivalEval && (
        arrivalRestriction ? (
          <div className="rounded-xl border border-border bg-surface p-5 space-y-1.5">
            <h3 className="text-sm font-bold text-purple-400">
              Not Eligible for {arrivalBounty.title}
            </h3>
            <p className="text-xs sm:text-sm text-text leading-relaxed">
              {arrivalRestriction.details}
            </p>
          </div>
        ) : (arrivalEval.overallScore ?? 0) < arrivalBounty.minScore ? (
          <div className="rounded-xl border border-border bg-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-purple-400">
                Not Eligible for {arrivalBounty.title}
              </h3>
              <p className="text-xs sm:text-sm text-text leading-relaxed">
                You are not eligible for this bounty yet: your CV scored{" "}
                <strong>{arrivalEval.overallScore ?? 0}/100</strong>, which is below the{" "}
                <strong>{arrivalBounty.minScore}/100</strong> requirement.
              </p>
            </div>
            <Link href={`/evaluations/${arrivalEval.id}/report`} className="shrink-0">
              <Button variant="outline" size="sm">
                View Report →
              </Button>
            </Link>
          </div>
        ) : arrivalSub?.reviewStatus === "pending_review" ? (
          <div className="rounded-xl border border-border bg-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-purple-400">
                Eligible · Slot Reserved ({arrivalEval.overallScore}/100)
              </h3>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                Your CV passed ({arrivalEval.overallScore}/100) for{" "}
                <strong className="text-text">{arrivalBounty.title}</strong>. Your winner
                slot is reserved for 24h in <code>pending_review</code>. Anchor your proof
                on-chain so your wallet is ready for payout.
              </p>
            </div>
            <Link href={`/evaluations/${arrivalEval.id}/report`} className="shrink-0">
              <Button variant="outline" size="sm">
                Anchor Proof On-Chain →
              </Button>
            </Link>
          </div>
        ) : arrivalBounty.availableSlots <= 0 ? (
          <div className="rounded-xl border border-border bg-surface p-5 space-y-1">
            <h3 className="text-sm font-bold text-purple-400">
              Not Eligible for Slot · All Winners Filled ({arrivalBounty.title})
            </h3>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              Your CV scored {arrivalEval.overallScore}/100, but all{" "}
              {arrivalBounty.maxWinners} winner slots are already reserved or claimed.
            </p>
          </div>
        ) : null
      )}

      <ErrorPopup
        title="Bounty Notice"
        message={error}
        onDismiss={() => setError(null)}
      />
      {notice && (
        <div className="rounded-xl border border-border bg-surface p-5 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-purple-400">Confirmed</h3>
            <p className="text-xs sm:text-sm text-text leading-relaxed">{notice}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Bounties List */}
      {!data?.bounties || data.bounties.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-12 text-center space-y-4">
          <h2 className="text-xl font-bold text-text">No Active Bounties Yet</h2>
          <p className="text-xs sm:text-sm text-text-secondary max-w-md mx-auto">
            Launch the first verifiable hiring bounty by locking Devnet USDC into an
            on-chain escrow vault for top-scoring candidates.
          </p>
          <Button variant="primary" size="md" onClick={handleOpenNewBounty}>
            Create First USDC Bounty
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.bounties.map((bounty) => {
            const occupied = bounty.occupiedSlots ?? bounty.claimsCount;
            const fillPct =
              bounty.maxWinners > 0
                ? Math.min(100, Math.round((occupied / bounty.maxWinners) * 100))
                : 0;
            const myClaim = data.myClaims.find((c) => c.bountyId === bounty.id);
            const mySub = data.mySubmissions?.find((s) => s.bountyId === bounty.id);
            const myRestriction = data.myRestrictions?.find((r) => r.bountyId === bounty.id);

            const matchingEvals = data.myEvaluations.filter(
              (ev) =>
                ev.jobDescriptionId === bounty.jobDescriptionId &&
                ev.status === "completed"
            );
            const claimableEval = matchingEvals.find(
              (ev) =>
                ev.evalTxSignature &&
                typeof ev.overallScore === "number" &&
                ev.overallScore >= bounty.minScore
            );
            const qualifyingUnanchored = matchingEvals.find(
              (ev) =>
                !ev.evalTxSignature &&
                typeof ev.overallScore === "number" &&
                ev.overallScore >= bounty.minScore
            );
            const bestIneligibleEval = matchingEvals
              .filter(
                (ev) =>
                  typeof ev.overallScore === "number" && ev.overallScore < bounty.minScore
              )
              .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))[0];

            const isExpired = bounty.isExpired;
            const isCreator =
              Boolean(data.currentUserId) &&
              data.currentUserId === bounty.recruiterUserId;

            const isSubUnlocked =
              mySub &&
              (mySub.reviewStatus === "approved" ||
                (mySub.reviewStatus === "pending_review" && mySub.isReviewExpired));

            return (
              <div
                key={bounty.id}
                className="rounded-xl border border-border hover:border-purple-500/40 transition-colors bg-surface p-6 sm:p-8 space-y-6 flex flex-col justify-between"
              >
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3.5 min-w-0">
                      <BountyCompanyLogo
                        company={bounty.company}
                        logoUrl={bounty.companyLogoUrl}
                        size="lg"
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-mono text-purple-400 font-semibold uppercase tracking-wider block truncate">
                          {bounty.company}
                        </span>
                        <h3 className="text-lg sm:text-xl font-extrabold text-text mt-0.5 truncate">
                          {bounty.title}
                        </h3>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 text-[11px] font-mono rounded-md bg-surface-elevated border border-border text-text-secondary shrink-0">
                      {bounty.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Pool & Threshold Metrics */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-lg bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase">
                        Reward
                      </span>
                      <p className="text-lg font-extrabold text-purple-400 mt-0.5">
                        {bounty.rewardPerWinnerUsdc} USDC
                      </p>
                    </div>
                    <div className="p-3.5 rounded-lg bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase">
                        Min Score
                      </span>
                      <p className="text-lg font-extrabold text-text mt-0.5">
                        {bounty.minScore}/100
                      </p>
                    </div>
                    <div className="p-3.5 rounded-lg bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase">
                        Total Pool
                      </span>
                      <p className="text-lg font-extrabold text-text mt-0.5">
                        {bounty.totalPoolUsdc} USDC
                      </p>
                    </div>
                  </div>

                  {/* Slots Progress */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono text-text-muted">
                      <span>
                        Slots: {bounty.claimsCount} paid
                        {bounty.approvedCount > 0
                          ? ` · ${bounty.approvedCount} approved`
                          : ""}
                        {bounty.pendingReviewCount > 0
                          ? ` · ${bounty.pendingReviewCount} in review`
                          : ""}{" "}
                        / {bounty.maxWinners} total
                      </span>
                      <span>
                        Expires: {new Date(bounty.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                    <ProgressBar value={fillPct} color="purple" size="sm" />
                  </div>

                  <p className="text-xs sm:text-sm text-text-secondary line-clamp-3 leading-relaxed">
                    {bounty.rawText}
                  </p>
                </div>

                <div className="space-y-3.5 pt-4 border-t border-border/70">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-text-muted">
                    <a
                      href={bounty.escrowUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-purple-400 hover:underline truncate max-w-[260px]"
                    >
                      Escrow PDA: {bounty.escrowPdaAddress.slice(0, 8)}...
                      {bounty.escrowPdaAddress.slice(-6)} →
                    </a>
                    {bounty.txUrl && (
                      <a
                        href={bounty.txUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-purple-400 hover:underline"
                      >
                        Funding Tx →
                      </a>
                    )}
                  </div>

                  {!isCreator && myRestriction && (
                    <div className="p-3.5 rounded-lg border border-border bg-surface-elevated text-xs space-y-1">
                      <span className="font-bold text-purple-400 uppercase font-mono">
                        Restricted ({myRestriction.reason.replace(/_/g, " ")})
                      </span>
                      <p className="text-text-secondary">{myRestriction.details}</p>
                    </div>
                  )}

                  {!myClaim &&
                    !myRestriction &&
                    mySub?.reviewStatus === "approved" && (
                      <div className="p-3.5 rounded-lg border border-purple-500/40 bg-surface-elevated text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-purple-400 uppercase font-mono">
                            Approved · Payout Ready to Claim
                          </span>
                          <span className="font-mono font-bold text-text">
                            {bounty.rewardPerWinnerUsdc} USDC
                          </span>
                        </div>
                        <p className="text-text-secondary">
                          {claimableEval
                            ? "Publisher approved your submission. Click Claim Approved USDC below to transfer escrow funds to your wallet."
                            : "Publisher approved your submission. Click below to anchor your evaluation proof and claim USDC directly into your wallet."}
                        </p>
                      </div>
                    )}

                  {!isCreator &&
                    mySub &&
                    mySub.reviewStatus === "pending_review" &&
                    !mySub.isReviewExpired && (
                      <div className="p-3.5 rounded-lg border border-border bg-surface-elevated text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-purple-400 uppercase font-mono">
                            Slot Reserved · Pending Review
                          </span>
                          <span className="font-mono text-text">
                            {mySub.remainingReviewLabel} left
                          </span>
                        </div>
                        <p className="text-text-secondary">
                          Recruiter can approve early for immediate release, or auto-claim unlocks automatically when the 24h window ends.
                        </p>
                      </div>
                    )}

                  {!isCreator &&
                    !myClaim &&
                    !myRestriction &&
                    (!mySub || mySub.reviewStatus === "below_threshold") &&
                    bestIneligibleEval && (
                      <div className="p-3.5 rounded-lg border border-border bg-surface-elevated text-xs space-y-1">
                        <span className="font-bold text-purple-400 uppercase font-mono">
                          Not Eligible · Score {bestIneligibleEval.overallScore}/100
                        </span>
                        <p className="text-text-secondary">
                          Required score is {bounty.minScore}/100. View your report to improve or defend your deductions.
                        </p>
                      </div>
                    )}

                  <div className="flex flex-wrap items-center gap-2.5">
                    {isCreator ? (
                      <>
                        <Link href={`/bounties/${bounty.id}/review`}>
                          <Button variant="primary" size="md">
                            Publisher Review Panel
                            {bounty.pendingReviewCount > 0
                              ? ` (${bounty.pendingReviewCount} pending)`
                              : bounty.approvedCount > 0
                              ? ` (${bounty.approvedCount} approved)`
                              : ""}{" "}
                            →
                          </Button>
                        </Link>
                        {!myClaim &&
                          isSubUnlocked &&
                          (claimableEval || qualifyingUnanchored) && (
                            <Button
                              variant="secondary"
                              size="md"
                              isLoading={busyBountyId === bounty.id}
                              onClick={() =>
                                void handleClaim(
                                  bounty,
                                  (claimableEval ?? qualifyingUnanchored)!.id,
                                  Boolean(claimableEval)
                                )
                              }
                            >
                              {!claimableEval
                                ? `Anchor Proof & Claim ${bounty.rewardPerWinnerUsdc} USDC`
                                : `Claim Approved ${bounty.rewardPerWinnerUsdc} USDC`}{" "}
                              →
                            </Button>
                          )}
                        {isExpired && bounty.status !== "refunded" && (
                          <Button
                            variant="outline"
                            size="md"
                            isLoading={busyBountyId === bounty.id}
                            onClick={() => void handleRefund(bounty)}
                          >
                            Withdraw Expired Escrow USDC
                          </Button>
                        )}
                      </>
                    ) : myClaim ? (
                      <span className="px-2.5 py-1 text-xs font-mono rounded-md bg-surface-elevated border border-border text-purple-400 font-bold">
                        Claimed {Number(myClaim.amountMicros) / 1_000_000} USDC
                      </span>
                    ) : myRestriction ? null : mySub &&
                      mySub.reviewStatus !== "below_threshold" &&
                      mySub.reviewStatus !== "evaluating" ? (
                      isSubUnlocked ? (
                        (claimableEval || qualifyingUnanchored) ? (
                          <Button
                            variant="primary"
                            size="md"
                            isLoading={busyBountyId === bounty.id}
                            onClick={() =>
                              void handleClaim(
                                bounty,
                                (claimableEval ?? qualifyingUnanchored)!.id,
                                Boolean(claimableEval)
                              )
                            }
                          >
                            {!claimableEval
                              ? `Anchor Proof & Claim ${bounty.rewardPerWinnerUsdc} USDC`
                              : mySub.reviewStatus === "approved"
                              ? `Claim Approved ${bounty.rewardPerWinnerUsdc} USDC`
                              : `Auto-Claim ${bounty.rewardPerWinnerUsdc} USDC`}{" "}
                            →
                          </Button>
                        ) : null
                      ) : mySub.reviewStatus === "pending_review" && qualifyingUnanchored ? (
                        <Link href={`/evaluations/${qualifyingUnanchored.id}/report`}>
                          <Button variant="outline" size="md">
                            Anchor Evaluation Proof ({qualifyingUnanchored.overallScore}/100) →
                          </Button>
                        </Link>
                      ) : null
                    ) : claimableEval || qualifyingUnanchored ? (
                      <Button
                        variant="secondary"
                        size="md"
                        isLoading={busyBountyId === bounty.id}
                        onClick={() =>
                          void handleSubmitSlot(
                            bounty,
                            (claimableEval ?? qualifyingUnanchored)!.id
                          )
                        }
                      >
                        Submit & Reserve Slot ({(claimableEval ?? qualifyingUnanchored)!.overallScore}/100) →
                      </Button>
                    ) : bestIneligibleEval ? (
                      <Link href={`/evaluations/${bestIneligibleEval.id}/report`}>
                        <Button variant="outline" size="md">
                          View Report ({bestIneligibleEval.overallScore}/100) →
                        </Button>
                      </Link>
                    ) : bounty.availableSlots <= 0 ? (
                      <span className="px-2.5 py-1 text-xs font-mono rounded-md bg-surface-elevated border border-border text-text-muted">
                        All Winner Slots Reserved / Paid
                      </span>
                    ) : bounty.status === "active" && !isExpired ? (
                      <Link href={`/evaluations/new?bountyId=${bounty.id}`}>
                        <Button variant="primary" size="md">
                          Apply & Evaluate CV →
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

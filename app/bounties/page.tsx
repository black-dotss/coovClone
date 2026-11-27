"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { apiFetch } from "@/lib/client/api";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";

interface BountyItem {
  id: string;
  recruiterUserId: string;
  recruiterWallet: string;
  jobDescriptionId: string;
  title: string;
  company: string;
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
  const { publicKey, openConnectModal, signAndSubmitTx, clusterLabel } =
    useSolanaWallet();

  const [data, setData] = useState<BountiesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
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

  const handleClaim = async (bounty: BountyItem, evalId: string) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setBusyBountyId(bounty.id);
    setError(null);
    setNotice(null);
    try {
      const prepared = await apiFetch<{ serializedTxBase64: string }>(
        `/api/solana/bounties/${bounty.id}/claim`,
        {
          method: "POST",
          body: JSON.stringify({
            walletAddress: publicKey,
            evaluationId: evalId,
          }),
        }
      );

      const txSignature = await signAndSubmitTx(prepared.serializedTxBase64);

      const confirmed = await apiFetch<{ amountPaidUsdc: number }>(
        `/api/solana/bounties/${bounty.id}/claim`,
        {
          method: "PATCH",
          body: JSON.stringify({
            walletAddress: publicKey,
            evaluationId: evalId,
            txSignature,
          }),
        }
      );

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

  // Resolve top eligibility banner when returning straight from a bounty CV review
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
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      {/* Compact Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text">
            Hiring Bounties
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary">
            USDC bounty escrows with verified CV screening on Solana {clusterLabel}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {!publicKey && (
            <Button variant="outline" size="sm" onClick={openConnectModal}>
              Connect Wallet
            </Button>
          )}
          <Link href="/profile?tab=solana">
            <Button variant="outline" size="md">
              On-Chain & SBT
            </Button>
          </Link>
          <Link href="/bounties/new">
            <Button variant="primary" size="md">
              + Post USDC Bounty Escrow
            </Button>
          </Link>
        </div>
      </div>

      {/* Direct Return Banner after Bounty CV Evaluation */}
      {arrivalBounty && arrivalEval && (
        arrivalRestriction ? (
          <Alert
            variant="danger"
            title={`Not Eligible for ${arrivalBounty.title}`}
          >
            {arrivalRestriction.details}
          </Alert>
        ) : (arrivalEval.overallScore ?? 0) < arrivalBounty.minScore ? (
          <Alert
            variant="warning"
            title={`Not Eligible for ${arrivalBounty.title}`}
            action={
              <Link href={`/evaluations/${arrivalEval.id}/report`}>
                <Button variant="outline" size="sm">
                  View Report →
                </Button>
              </Link>
            }
          >
            You are not eligible for this bounty yet: your CV scored{" "}
            <strong>{arrivalEval.overallScore ?? 0}/100</strong>, which is below the{" "}
            <strong>{arrivalBounty.minScore}/100</strong> requirement.
          </Alert>
        ) : arrivalSub?.reviewStatus === "pending_review" ? (
          <Alert
            variant="success"
            title={`Eligible · Slot Reserved (${arrivalEval.overallScore}/100)`}
            action={
              <Link href={`/evaluations/${arrivalEval.id}/report`}>
                <Button variant="outline" size="sm">
                  Anchor Proof On-Chain →
                </Button>
              </Link>
            }
          >
            Your CV passed ({arrivalEval.overallScore}/100) for{" "}
            <strong>{arrivalBounty.title}</strong>! Your winner slot is reserved for 24h in{" "}
            <code>pending_review</code>. Anchor your proof on-chain so your wallet is ready
            for payout.
          </Alert>
        ) : arrivalBounty.availableSlots <= 0 ? (
          <Alert
            variant="warning"
            title={`Not Eligible for Slot · All Winners Filled (${arrivalBounty.title})`}
          >
            Your CV scored {arrivalEval.overallScore}/100, but all{" "}
            {arrivalBounty.maxWinners} winner slots are already reserved or claimed.
          </Alert>
        ) : null
      )}

      {error && (
        <Alert
          variant="danger"
          title="Bounty Notice"
          action={
            <Button variant="outline" size="sm" onClick={() => setError(null)}>
              Dismiss
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {notice && (
        <Alert variant="success" title="Transaction Confirmed">
          {notice}
        </Alert>
      )}

      {/* Bounties List */}
      {loading ? (
        <div className="py-16 flex justify-center">
          <LoadingSpinner size="lg" label="Loading Devnet USDC bounty escrows..." />
        </div>
      ) : !data?.bounties || data.bounties.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center space-y-4">
          <h2 className="text-lg font-bold text-text">No Active Bounties Yet</h2>
          <p className="text-xs sm:text-sm text-text-secondary max-w-md mx-auto">
            Launch the first verifiable hiring bounty by locking Devnet USDC into an
            on-chain escrow vault for top-scoring candidates.
          </p>
          <Link href="/bounties/new">
            <Button variant="primary" size="md">
              Create First USDC Bounty
            </Button>
          </Link>
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
                className="rounded-xl border border-border hover:border-purple-500/40 transition-colors bg-surface p-6 space-y-5 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-mono text-purple-400 font-semibold uppercase tracking-wider">
                        {bounty.company}
                      </span>
                      <h3 className="text-lg font-extrabold text-text mt-0.5">
                        {bounty.title}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 text-[11px] font-mono rounded-md bg-surface-elevated border border-border text-text-secondary">
                      {bounty.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Pool & Threshold Metrics */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="p-3 rounded-lg bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase">
                        Reward
                      </span>
                      <p className="text-base font-extrabold text-purple-400 mt-0.5">
                        {bounty.rewardPerWinnerUsdc} USDC
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase">
                        Min Score
                      </span>
                      <p className="text-base font-extrabold text-text mt-0.5">
                        {bounty.minScore}/100
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase">
                        Total Pool
                      </span>
                      <p className="text-base font-extrabold text-text mt-0.5">
                        {bounty.totalPoolUsdc} USDC
                      </p>
                    </div>
                  </div>

                  {/* Slots Progress */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-mono text-text-muted">
                      <span>
                        Slots: {bounty.claimsCount} paid
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

                  <p className="text-xs text-text-secondary line-clamp-3 leading-relaxed">
                    {bounty.rawText}
                  </p>
                </div>

                <div className="space-y-3 pt-4 border-t border-border/70">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-text-muted">
                    <a
                      href={bounty.escrowUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-purple-400 hover:underline truncate max-w-[230px]"
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
                    <div className="p-3 rounded-lg border border-red-500/40 bg-surface-elevated text-xs space-y-1">
                      <span className="font-bold text-red-400 uppercase font-mono">
                        Restricted ({myRestriction.reason.replace(/_/g, " ")})
                      </span>
                      <p className="text-text-secondary">{myRestriction.details}</p>
                    </div>
                  )}

                  {!isCreator &&
                    mySub &&
                    mySub.reviewStatus === "pending_review" &&
                    !mySub.isReviewExpired && (
                      <div className="p-3 rounded-lg border border-border bg-surface-elevated text-xs space-y-1">
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
                      <div className="p-3 rounded-lg border border-border bg-surface-elevated text-xs space-y-1">
                        <span className="font-bold text-red-400 uppercase font-mono">
                          Not Eligible · Score {bestIneligibleEval.overallScore}/100
                        </span>
                        <p className="text-text-secondary">
                          Required score is {bounty.minScore}/100. View your report to improve or defend your deductions.
                        </p>
                      </div>
                    )}

                  <div className="flex flex-wrap items-center gap-2">
                    {isCreator ? (
                      <>
                        <Link href={`/bounties/${bounty.id}/review`}>
                          <Button variant="primary" size="sm">
                            Publisher Review Panel
                            {bounty.pendingReviewCount > 0
                              ? ` (${bounty.pendingReviewCount} pending)`
                              : ""}{" "}
                            →
                          </Button>
                        </Link>
                        {isExpired && bounty.status !== "refunded" && (
                          <Button
                            variant="outline"
                            size="sm"
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
                        claimableEval ? (
                          <Button
                            variant="primary"
                            size="sm"
                            isLoading={busyBountyId === bounty.id}
                            onClick={() => void handleClaim(bounty, claimableEval.id)}
                          >
                            {mySub.reviewStatus === "approved"
                              ? `Claim Approved ${bounty.rewardPerWinnerUsdc} USDC`
                              : `Auto-Claim ${bounty.rewardPerWinnerUsdc} USDC`}{" "}
                            →
                          </Button>
                        ) : qualifyingUnanchored ? (
                          <Link href={`/evaluations/${qualifyingUnanchored.id}/report`}>
                            <Button variant="secondary" size="sm">
                              Anchor Proof to Claim {bounty.rewardPerWinnerUsdc} USDC →
                            </Button>
                          </Link>
                        ) : null
                      ) : mySub.reviewStatus === "pending_review" && qualifyingUnanchored ? (
                        <Link href={`/evaluations/${qualifyingUnanchored.id}/report`}>
                          <Button variant="outline" size="sm">
                            Anchor Evaluation Proof ({qualifyingUnanchored.overallScore}/100) →
                          </Button>
                        </Link>
                      ) : null
                    ) : claimableEval || qualifyingUnanchored ? (
                      <Button
                        variant="secondary"
                        size="sm"
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
                        <Button variant="outline" size="sm">
                          View Report ({bestIneligibleEval.overallScore}/100) →
                        </Button>
                      </Link>
                    ) : bounty.availableSlots <= 0 ? (
                      <span className="px-2.5 py-1 text-xs font-mono rounded-md bg-surface-elevated border border-border text-text-muted">
                        All Winner Slots Reserved / Paid
                      </span>
                    ) : bounty.status === "active" && !isExpired ? (
                      <Link href={`/evaluations/new?bountyId=${bounty.id}`}>
                        <Button variant="primary" size="sm">
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

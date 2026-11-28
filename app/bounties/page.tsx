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
import {
  captureScoutReferralFromSearch,
  getStoredScoutReferral,
} from "@/lib/solana/scout-referral";

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
  minStreak?: number;
  rewardPerWinnerUsdc: number;
  candidate90Usdc?: number;
  scout10Usdc?: number;
  totalPoolUsdc: number;
  stakeBps?: number;
  stakePercent?: number;
  stakePerCandidateUsdc?: number;
  slashedPoolUsdc?: number;
  proRataBonusUsdc?: number;
  maxWinners: number;
  claimsCount: number;
  openDisputesCount?: number;
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

interface CandidateReputationSummary {
  effectiveStreak: number;
  fraudFlags: number;
  totalEarnedUsdc: number;
  isFresh: boolean;
  isZeroStakeVip: boolean;
  daysUntilDecay: number | null;
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
  stakePdaAddress?: string | null;
  stakeAmountUsdc?: number;
  stakeStatus?: string;
  isZeroStakeVip?: boolean;
  referrerWallet?: string | null;
  scoutCutUsdc?: number;
  isReviewExpired: boolean;
  remainingReviewLabel: string | null;
}

interface RestrictionSummary {
  bountyId: string;
  reason: string;
  details: string;
  createdAt: string;
}

interface JurorEligibilitySummary {
  eligible: boolean;
  method: "sbt" | "streak" | "none";
  activeStreak: number;
  fraudFlags: number;
  sbtMint: string | null;
  sbtAta: string | null;
  sbtCount: number;
}

interface JuryDisputeItem {
  id: string;
  bountyId: string;
  bountyTitle: string;
  company: string;
  companyLogoUrl: string | null;
  recruiterUserId: string;
  recruiterWallet: string;
  rewardPerWinnerUsdc: number;
  stakeAmountUsdc: number;
  candidateWallet: string;
  candidateWalletMasked: string;
  disputeTicketPda: string;
  openTxSignature: string;
  resolveTxSignature: string | null;
  evaluationScore: number;
  rejectionReason: string;
  votesForCandidate: number;
  votesForRecruiter: number;
  jurorWallets: string[];
  status: string;
  openedAt: string;
  resolvedAt: string | null;
  isCurrentUserCandidate: boolean;
  isCurrentUserCreator: boolean;
  hasCurrentUserVoted: boolean;
  anonymizedBreakdown: {
    overallScore: number;
    verdict: string | null;
    explanation: string;
    strengths: string[];
    weaknesses: string[];
    redFlags: Array<{ flag: string; evidenceSnippet: string }>;
    agentSummaries: Array<{
      agentRole: string;
      scoreContribution: number | null;
      position: string | null;
    }>;
  };
}

interface BountiesApiResponse {
  cluster: string;
  currentUserId: string | null;
  bounties: BountyItem[];
  myEvaluations: CandidateEvalSummary[];
  myClaims: CandidateClaimSummary[];
  mySubmissions?: CandidateSubmissionSummary[];
  myRestrictions?: RestrictionSummary[];
  candidateReputation?: CandidateReputationSummary | null;
  jurorEligibility?: JurorEligibilitySummary;
  activeDisputes?: JuryDisputeItem[];
  disputes?: JuryDisputeItem[];
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
  const [busyDisputeKey, setBusyDisputeKey] = useState<string | null>(null);
  const [expandedDisputes, setExpandedDisputes] = useState<Record<string, boolean>>({});
  const [copiedScoutBountyId, setCopiedScoutBountyId] = useState<string | null>(null);
  const [capturedScoutRef, setCapturedScoutRef] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const captured = captureScoutReferralFromSearch(window.location.search);
    return captured ?? getStoredScoutReferral([], publicKey);
  });

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
    const initialCaptured =
      typeof window !== "undefined"
        ? captureScoutReferralFromSearch(window.location.search)
        : null;

    if (
      typeof window !== "undefined" &&
      (window.location.search.includes("created=1") ||
        window.location.search.includes("fromEval=") ||
        window.location.search.includes("ref=") ||
        window.location.search.includes("referrer="))
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
        if (active) {
          setData(res);
          setCapturedScoutRef(
            initialCaptured ?? getStoredScoutReferral([], publicKey)
          );
        }
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

  const handleCopyScoutLink = async (bounty: BountyItem) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/bounties/${bounty.id}?ref=${encodeURIComponent(
      publicKey
    )}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedScoutBountyId(bounty.id);
      setNotice(
        `Scout referral link copied for ${bounty.title}! You earn 10% (${(
          bounty.scout10Usdc ?? bounty.rewardPerWinnerUsdc * 0.1
        ).toFixed(2)} USDC) on-chain when your referred candidate wins.`
      );
      setTimeout(() => {
        setCopiedScoutBountyId((prev) => (prev === bounty.id ? null : prev));
      }, 3000);
    } catch {
      showError(new Error("Clipboard access failed."), "Could not copy Scout link.");
    }
  };

  const handleSubmitSlot = async (bounty: BountyItem, evalId: string) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setBusyBountyId(bounty.id);
    setError(null);
    setNotice(null);
    const referrerWallet = getStoredScoutReferral(
      [bounty.id, bounty.jobDescriptionId],
      publicKey
    );
    try {
      const preparedStake = await apiFetch<{
        serializedTxBase64: string;
        stakeUsdc: number;
        isZeroStakeVip?: boolean;
      }>(`/api/solana/bounties/${bounty.id}/stake`, {
        method: "POST",
        body: JSON.stringify({
          walletAddress: publicKey,
          referrerWallet,
        }),
      });

      const stakeTxSignature = await signAndSubmitTx(preparedStake.serializedTxBase64);

      await apiFetch(`/api/solana/bounties/${bounty.id}/submit`, {
        method: "POST",
        body: JSON.stringify({
          evaluationId: evalId,
          walletAddress: publicKey,
          stakeTxSignature,
          referrerWallet,
        }),
      });
      setNotice(
        preparedStake.isZeroStakeVip
          ? "Verified Streak VIP unlocked 0 USDC Stake & reserved slot in pending_review!"
          : `Locked ${preparedStake.stakeUsdc} USDC Conviction Stake & reserved slot in pending_review! Stake + slashed spam yield release with your reward on approval.`
      );
      await loadBounties();
    } catch (err) {
      showError(err, "Failed to lock Conviction Stake and reserve bounty slot.");
      await loadBounties();
    } finally {
      setBusyBountyId(null);
    }
  };

  const handleRefundStake = async (bounty: BountyItem, submissionId: string) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setBusyBountyId(bounty.id);
    setError(null);
    setNotice(null);
    try {
      const prep = await apiFetch<{
        serializedTxBase64: string;
        submissionId: string;
      }>(`/api/solana/bounties/${bounty.id}/refund-stake`, {
        method: "POST",
        body: JSON.stringify({
          walletAddress: publicKey,
          submissionId,
        }),
      });

      const txSignature = await signAndSubmitTx(prep.serializedTxBase64);
      const conf = await apiFetch<{ amountRefundedUsdc: number }>(
        `/api/solana/bounties/${bounty.id}/refund-stake`,
        {
          method: "PATCH",
          body: JSON.stringify({
            walletAddress: publicKey,
            submissionId: prep.submissionId,
            txSignature,
          }),
        }
      );

      setNotice(
        `Refunded ${conf.amountRefundedUsdc} USDC Conviction Stake back to your wallet.`
      );
      await loadBounties();
    } catch (err) {
      showError(err, "Failed to reclaim Conviction Stake.");
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

  const handleOpenDispute = async (
    bounty: BountyItem,
    evalItem: CandidateEvalSummary
  ) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setBusyBountyId(bounty.id);
    setError(null);
    setNotice(null);
    try {
      if (!evalItem.evalTxSignature) {
        const anchorPrep = await apiFetch<{ serializedTxBase64: string }>(
          `/api/solana/evaluations/${evalItem.id}`,
          {
            method: "POST",
            body: JSON.stringify({ walletAddress: publicKey }),
          }
        );
        const anchorSig = await signAndSubmitTx(anchorPrep.serializedTxBase64);
        await apiFetch(`/api/solana/evaluations/${evalItem.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            walletAddress: publicKey,
            txSignature: anchorSig,
          }),
        });
      }

      const prep = await apiFetch<{
        serializedTxBase64: string;
        disputeTicketPda: string;
      }>(`/api/solana/bounties/${bounty.id}/dispute`, {
        method: "POST",
        body: JSON.stringify({
          walletAddress: publicKey,
          evaluationId: evalItem.id,
        }),
      });

      const txSignature = await signAndSubmitTx(prep.serializedTxBase64);

      await apiFetch(`/api/solana/bounties/${bounty.id}/dispute`, {
        method: "PATCH",
        body: JSON.stringify({
          walletAddress: publicKey,
          evaluationId: evalItem.id,
          txSignature,
        }),
      });

      setNotice(
        `Opened On-Chain No-Chill Dispute Jury ticket (${prep.disputeTicketPda.slice(0, 8)}...) for ${bounty.title}. 2-of-3 peer votes now override rejection.`
      );
      await loadBounties();
    } catch (err) {
      showError(err, "Failed to open On-Chain Jury Dispute.");
    } finally {
      setBusyBountyId(null);
    }
  };

  const handleCastJuryVote = async (
    dispute: JuryDisputeItem,
    approveCandidate: boolean
  ) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    const lockKey = `${dispute.id}:${approveCandidate ? "pay" : "uphold"}`;
    setBusyDisputeKey(lockKey);
    setError(null);
    setNotice(null);
    try {
      const prep = await apiFetch<{
        serializedTxBase64: string;
        willReachConsensus: boolean;
      }>(`/api/solana/disputes/${dispute.id}/vote`, {
        method: "POST",
        body: JSON.stringify({
          walletAddress: publicKey,
          approveCandidate,
        }),
      });

      const txSignature = await signAndSubmitTx(prep.serializedTxBase64);

      const confirmed = await apiFetch<{
        status: string;
        votesForCandidate: number;
        votesForRecruiter: number;
        totalPaidUsdc: number;
        slashedAmountUsdc: number;
      }>(`/api/solana/disputes/${dispute.id}/vote`, {
        method: "PATCH",
        body: JSON.stringify({
          walletAddress: publicKey,
          approveCandidate,
          txSignature,
        }),
      });

      if (confirmed.status === "resolved_candidate") {
        setNotice(
          `2-of-3 Jury Override Reached! Paid ${confirmed.totalPaidUsdc.toFixed(2)} USDC directly from escrow to the candidate and unlocked the dispute lock.`
        );
      } else if (confirmed.status === "resolved_recruiter") {
        setNotice(
          `2-of-3 Jury Upheld Rejection! Slashed ${confirmed.slashedAmountUsdc.toFixed(2)} USDC into Slashed Spam Yield pool and unlocked the escrow.`
        );
      } else {
        setNotice(
          `Jury vote recorded on-chain (${confirmed.votesForCandidate}/2 Pay Candidate · ${confirmed.votesForRecruiter}/2 Uphold).`
        );
      }
      await loadBounties();
    } catch (err) {
      showError(err, "Failed to submit on-chain jury vote.");
    } finally {
      setBusyDisputeKey(null);
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
      {capturedScoutRef && !notice && (
        <div className="rounded-xl border border-border bg-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="space-y-0.5">
            <span className="font-bold text-purple-400 font-mono uppercase">
              Scout Referral Captured ({capturedScoutRef.slice(0, 6)}...{capturedScoutRef.slice(-4)})
            </span>
            <p className="text-text-secondary">
              Applying through this link triggers an atomic on-chain 90/10 split on approval (90% Candidate + 100% refunded stake + bonus yield, 10% Scout).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCapturedScoutRef(null)}>
            Dismiss
          </Button>
        </div>
      )}

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
            const bestDisputeEval = matchingEvals
              .filter(
                (ev) =>
                  typeof ev.overallScore === "number" && ev.overallScore >= 90
              )
              .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))[0];

            const isExpired = bounty.isExpired;
            const isCreator =
              Boolean(data.currentUserId) &&
              data.currentUserId === bounty.recruiterUserId;

            const isDisputeEligible = Boolean(
              bestDisputeEval &&
                (bestDisputeEval.overallScore ?? 0) >= 90 &&
                (mySub?.reviewStatus === "rejected" ||
                  myRestriction?.reason === "recruiter_rejected") &&
                mySub?.fakeDetectorStatus !== "flagged" &&
                myRestriction?.reason !== "fake_resume_detected" &&
                myRestriction?.reason !== "duplicate_resume"
            );
            const myDispute = data.disputes?.find(
              (d) => d.bountyId === bounty.id && d.isCurrentUserCandidate
            );
            const canOpenDispute = Boolean(
              !isCreator &&
                !myClaim &&
                !myDispute &&
                isDisputeEligible &&
                !isExpired &&
                bounty.status === "active"
            );

            const isSubUnlocked =
              mySub &&
              (mySub.reviewStatus === "approved" ||
                (mySub.reviewStatus === "pending_review" && mySub.isReviewExpired));

            const isZeroStakeVip = Boolean(data.candidateReputation?.isZeroStakeVip);
            const activeStreak = data.candidateReputation?.effectiveStreak ?? 0;
            const requiredStreak = bounty.minStreak ?? 0;
            const meetsMinStreak =
              requiredStreak <= 0 ||
              (Boolean(data.candidateReputation) &&
                (data.candidateReputation?.fraudFlags ?? 0) === 0 &&
                Boolean(data.candidateReputation?.isFresh) &&
                activeStreak >= requiredStreak);
            const standardStakeUsdc =
              bounty.stakePerCandidateUsdc ??
              (bounty.rewardPerWinnerUsdc * (bounty.stakePercent ?? 10)) / 100;
            const candidate90Usdc =
              bounty.candidate90Usdc ?? bounty.rewardPerWinnerUsdc * 0.9;
            const scout10Usdc =
              bounty.scout10Usdc ?? bounty.rewardPerWinnerUsdc * 0.1;
            const activeReferrer = getStoredScoutReferral(
              [bounty.id, bounty.jobDescriptionId],
              publicKey
            );

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
                          <Link
                            href={`/bounties/${bounty.id}`}
                            className="hover:text-purple-400 transition-colors"
                          >
                            {bounty.title}
                          </Link>
                        </h3>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 text-[11px] font-mono rounded-md bg-surface-elevated border border-border text-text-secondary shrink-0">
                      {bounty.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Pool, 90/10 Scout Split, Stake, & Live Slashed Spam Yield Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3.5 rounded-lg bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase block">
                        Reward
                      </span>
                      <p className="text-base sm:text-lg font-extrabold text-purple-400 mt-0.5">
                        {bounty.rewardPerWinnerUsdc} USDC
                      </p>
                      <span className="text-[10px] font-mono text-text-muted block">
                        90/10: {candidate90Usdc.toFixed(2)} / {scout10Usdc.toFixed(2)}
                      </span>
                    </div>
                    <div className="p-3.5 rounded-lg bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase block">
                        Min Score
                      </span>
                      <p className="text-base sm:text-lg font-extrabold text-text mt-0.5">
                        {bounty.minScore}/100
                      </p>
                      <span className="text-[10px] font-mono text-text-muted block">
                        {requiredStreak > 0
                          ? `Min Streak: ${requiredStreak}+`
                          : "Open streak (0+)"}
                      </span>
                    </div>
                    <div className="p-3.5 rounded-lg bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase block">
                        {isZeroStakeVip ? "Conviction Perk" : `Stake (${bounty.stakePercent ?? 10}%)`}
                      </span>
                      <p
                        className={`text-base sm:text-lg font-extrabold mt-0.5 ${
                          isZeroStakeVip ? "text-purple-400" : "text-text"
                        }`}
                      >
                        {isZeroStakeVip ? "0 USDC Stake" : `${standardStakeUsdc.toFixed(2)} USDC`}
                      </p>
                      {isZeroStakeVip && (
                        <span className="text-[10px] font-mono text-purple-400 block">
                          Verified Streak Perk
                        </span>
                      )}
                    </div>
                    <div className="p-3.5 rounded-lg bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase block">
                        Slashed Spam Yield
                      </span>
                      <p
                        className={`text-base sm:text-lg font-extrabold mt-0.5 ${
                          (bounty.slashedPoolUsdc ?? 0) > 0
                            ? "text-purple-400"
                            : "text-text"
                        }`}
                      >
                        +{(bounty.slashedPoolUsdc ?? 0).toFixed(2)} USDC
                      </p>
                      {(bounty.proRataBonusUsdc ?? 0) > 0 && (
                        <span className="text-[10px] font-mono text-purple-400 block">
                          +{bounty.proRataBonusUsdc?.toFixed(2)} USDC / slot
                        </span>
                      )}
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
                    <div className="flex flex-wrap items-center gap-3">
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

                    <button
                      type="button"
                      onClick={() => void handleCopyScoutLink(bounty)}
                      className="px-2.5 py-1 rounded-md bg-surface-elevated border border-border text-purple-400 hover:border-purple-500/60 transition-colors cursor-pointer font-semibold"
                    >
                      {copiedScoutBountyId === bounty.id
                        ? "Copied Scout Link!"
                        : "Share & Earn 10% Scout Cut"}
                    </button>
                  </div>

                  {!isCreator && myRestriction && !canOpenDispute && !myDispute && (
                    <div className="p-3.5 rounded-lg border border-border bg-surface-elevated text-xs space-y-1">
                      <span className="font-bold text-purple-400 uppercase font-mono">
                        Restricted ({myRestriction.reason.replace(/_/g, " ")})
                      </span>
                      <p className="text-text-secondary">{myRestriction.details}</p>
                    </div>
                  )}

                  {!isCreator && canOpenDispute && (
                    <div className="p-3.5 rounded-lg border border-purple-500/40 bg-surface-elevated text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-purple-400 uppercase font-mono">
                          Rejected With {bestDisputeEval?.overallScore ?? 90}/100 · Dispute Eligible
                        </span>
                        <span className="font-mono text-text-muted">2-of-3 Jury</span>
                      </div>
                      <p className="text-text-secondary">
                        {mySub?.recruiterNotes ||
                          myRestriction?.details ||
                          "Publisher rejected this submission."}
                      </p>
                    </div>
                  )}

                  {!isCreator && myDispute && (
                    <div className="p-3.5 rounded-lg border border-purple-500/40 bg-surface-elevated text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-purple-400 uppercase font-mono">
                          {myDispute.status === "resolved_candidate"
                            ? "Jury Override Won (2/3)"
                            : myDispute.status === "resolved_recruiter"
                            ? "Jury Upheld Rejection (2/3)"
                            : `Dispute Jury Open (${myDispute.votesForCandidate}/2 Pay · ${myDispute.votesForRecruiter}/2 Uphold)`}
                        </span>
                        <span className="font-mono text-text-muted">
                          Score {myDispute.evaluationScore}/100
                        </span>
                      </div>
                      <p className="text-text-secondary">
                        {myDispute.status === "resolved_candidate"
                          ? "2-of-3 peer jurors overrode the rejection and released your USDC reward + refunded stake on-chain."
                          : myDispute.status === "resolved_recruiter"
                          ? "2-of-3 peer jurors upheld the rejection and slashed any disputed stake into the bounty spam pool."
                          : "Escrow early withdrawal is frozen while peer SBT/streak jurors vote in the Active Jury Disputes panel below."}
                      </p>
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
                          (bounty.openDisputesCount ?? 0) > 0 ? (
                            <Button variant="outline" size="md" disabled>
                              Escrow Frozen ({bounty.openDisputesCount} Open Dispute)
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="md"
                              isLoading={busyBountyId === bounty.id}
                              onClick={() => void handleRefund(bounty)}
                            >
                              Withdraw Expired Escrow USDC
                            </Button>
                          )
                        )}
                      </>
                    ) : myClaim ? (
                      <span className="px-2.5 py-1 text-xs font-mono rounded-md bg-surface-elevated border border-border text-purple-400 font-bold">
                        Claimed {Number(myClaim.amountMicros) / 1_000_000} USDC
                      </span>
                    ) : canOpenDispute && bestDisputeEval ? (
                      <Button
                        variant="primary"
                        size="md"
                        isLoading={busyBountyId === bounty.id}
                        onClick={() => void handleOpenDispute(bounty, bestDisputeEval)}
                      >
                        Open On-Chain Jury Dispute →
                      </Button>
                    ) : myDispute ? (
                      <a
                        href="#active-jury-disputes"
                        className="px-3 py-1.5 text-xs font-mono rounded-md bg-surface-elevated border border-purple-500/40 text-purple-400 font-bold hover:border-purple-400 transition-colors"
                      >
                        View Jury Ticket ({myDispute.votesForCandidate}/2 Override) →
                      </a>
                    ) : myRestriction ? null : mySub &&
                      mySub.reviewStatus === "below_threshold" &&
                      mySub.stakeStatus === "pending" ? (
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Button
                          variant="primary"
                          size="md"
                          isLoading={busyBountyId === bounty.id}
                          onClick={() => void handleRefundStake(bounty, mySub.id)}
                        >
                          Reclaim {mySub.stakeAmountUsdc ?? 0} USDC Stake →
                        </Button>
                        {bestIneligibleEval && (
                          <Link href={`/evaluations/${bestIneligibleEval.id}/report`}>
                            <Button variant="outline" size="md">
                              View Report ({bestIneligibleEval.overallScore}/100) →
                            </Button>
                          </Link>
                        )}
                      </div>
                    ) : mySub &&
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
                            {(() => {
                              const extraStake =
                                mySub.stakeStatus === "pending"
                                  ? (mySub.stakeAmountUsdc ?? 0) + (bounty.proRataBonusUsdc ?? 0)
                                  : 0;
                              const payoutLabel = (
                                bounty.rewardPerWinnerUsdc + extraStake
                              ).toFixed(2);
                              return !claimableEval
                                ? `Anchor Proof & Claim ${payoutLabel} USDC`
                                : mySub.reviewStatus === "approved"
                                ? `Claim Approved ${payoutLabel} USDC`
                                : `Auto-Claim ${payoutLabel} USDC`;
                            })()}{" "}
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
                      <div className="space-y-1.5">
                        <Button
                          variant="secondary"
                          size="md"
                          isLoading={busyBountyId === bounty.id}
                          disabled={!meetsMinStreak}
                          onClick={() =>
                            void handleSubmitSlot(
                              bounty,
                              (claimableEval ?? qualifyingUnanchored)!.id
                            )
                          }
                        >
                          {isZeroStakeVip
                            ? `Enter Review with 0 USDC Stake (VIP Perk) (${(claimableEval ?? qualifyingUnanchored)!.overallScore}/100) →`
                            : `Stake ${standardStakeUsdc.toFixed(2)} USDC & Enter Review (${(claimableEval ?? qualifyingUnanchored)!.overallScore}/100) →`}
                        </Button>
                        <p className="text-[11px] font-mono text-text-muted">
                          {!meetsMinStreak
                            ? `Requires ${requiredStreak}+ active streak (30d fresh, 0 fraud flags) to enter.`
                            : isZeroStakeVip
                            ? "0 USDC Stake (Verified Streak Perk) · keep slashed spam yield on approval"
                            : `${standardStakeUsdc.toFixed(2)} USDC stake → get stake back + slashed spam yield on approval`}
                        </p>
                      </div>
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
                      <div className="space-y-1.5">
                        <Link
                          href={
                            meetsMinStreak
                              ? `/evaluations/new?bountyId=${bounty.id}${
                                  activeReferrer
                                    ? `&ref=${encodeURIComponent(activeReferrer)}`
                                    : ""
                                }`
                              : "#"
                          }
                          aria-disabled={!meetsMinStreak}
                          onClick={(e) => {
                            if (!meetsMinStreak) {
                              e.preventDefault();
                              showError(
                                new Error(
                                  `This bounty requires a ${requiredStreak}+ active verified streak (within 30 days, 0 fraud flags). Your current active streak is ${activeStreak}.`
                                ),
                                "Minimum Streak Not Met"
                              );
                            }
                          }}
                        >
                          <Button variant="primary" size="md" disabled={!meetsMinStreak}>
                            {isZeroStakeVip
                              ? "Apply · 0 USDC Stake (Verified Streak Perk) →"
                              : `Apply & Stake ${standardStakeUsdc.toFixed(2)} USDC →`}
                          </Button>
                        </Link>
                        <p className="text-[11px] font-mono text-text-muted">
                          {!meetsMinStreak
                            ? `Requires ${requiredStreak}+ active streak (30d fresh, 0 fraud flags) to apply.`
                            : isZeroStakeVip
                            ? "0 USDC Stake (Verified Streak Perk) · waived by your active 2+ streak"
                            : `${standardStakeUsdc.toFixed(2)} USDC stake → get stake back + slashed spam yield on approval`}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* On-Chain "No-Chill" Dispute Jury Panel */}
      <section
        id="active-jury-disputes"
        className="rounded-xl border border-border bg-surface p-6 sm:p-8 space-y-6"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-border">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl sm:text-2xl font-extrabold text-text">
                Active Jury Disputes
              </h2>
              <span className="px-2.5 py-0.5 text-xs font-mono rounded-md bg-surface-elevated border border-border text-purple-400 font-bold">
                {(data?.activeDisputes?.length ?? 0)} OPEN · 2-OF-3 CONSENSUS
              </span>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary">
              Independent Token-2022 SBT or active streak (&ge; 1) peers inspect anonymized evaluations to override wrongful recruiter rejections or uphold slashes.
            </p>
          </div>

          <div className="shrink-0">
            {!publicKey ? (
              <Button variant="outline" size="sm" onClick={openConnectModal}>
                Connect Wallet to Verify Juror Status
              </Button>
            ) : data?.jurorEligibility?.eligible ? (
              <span className="px-3 py-1.5 text-xs font-mono rounded-md bg-surface-elevated border border-purple-500/40 text-purple-400 font-bold inline-block">
                {data.jurorEligibility.method === "sbt"
                  ? `Verified Juror · Token-2022 SBT (${data.jurorEligibility.sbtCount})`
                  : `Verified Juror · Streak ${data.jurorEligibility.activeStreak}+`}
              </span>
            ) : (
              <span className="px-3 py-1.5 text-xs font-mono rounded-md bg-surface-elevated border border-border text-text-muted inline-block">
                Requires COOV SBT or Active Streak &ge; 1 to Vote
              </span>
            )}
          </div>
        </div>

        {!data?.disputes || data.disputes.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-elevated p-6 text-center space-y-1.5">
            <p className="text-sm font-bold text-text">No On-Chain Jury Disputes Open</p>
            <p className="text-xs text-text-secondary">
              Rejected candidates holding a verified 90/100+ evaluation proof (and 0 fraud flags) can open a 2-of-3 Jury Dispute directly from their bounty card before expiration.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.disputes.map((dispute) => {
              const isOpen = dispute.status === "open";
              const isExpanded = Boolean(expandedDisputes[dispute.id]);
              const overridePct = Math.min(100, Math.round((dispute.votesForCandidate / 2) * 100));
              const upholdPct = Math.min(100, Math.round((dispute.votesForRecruiter / 2) * 100));
              const canVote =
                isOpen &&
                Boolean(data.jurorEligibility?.eligible) &&
                !dispute.isCurrentUserCandidate &&
                !dispute.isCurrentUserCreator &&
                !dispute.hasCurrentUserVoted;

              const statusTag =
                dispute.status === "resolved_candidate"
                  ? "RESOLVED · PAID CANDIDATE (2/3)"
                  : dispute.status === "resolved_recruiter"
                  ? "RESOLVED · UPHELD REJECTION (2/3)"
                  : `${dispute.votesForCandidate} / 2 Votes to Override`;

              return (
                <div
                  key={dispute.id}
                  className="rounded-xl border border-border bg-surface-elevated p-5 sm:p-6 space-y-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex items-start gap-3.5 min-w-0">
                      <BountyCompanyLogo
                        company={dispute.company}
                        logoUrl={dispute.companyLogoUrl}
                        size="md"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-mono text-purple-400 font-bold uppercase">
                            {dispute.company}
                          </span>
                          <span className="text-[11px] font-mono text-text-muted">
                            Candidate #{dispute.candidateWalletMasked}
                          </span>
                        </div>
                        <h3 className="text-base sm:text-lg font-extrabold text-text">
                          {dispute.bountyTitle}
                        </h3>
                        <p className="text-[11px] font-mono text-text-muted">
                          Score: <strong className="text-purple-400">{dispute.evaluationScore}/100</strong> · Reward:{" "}
                          <strong className="text-text">{dispute.rewardPerWinnerUsdc} USDC</strong> · Stake:{" "}
                          <strong className="text-text">{dispute.stakeAmountUsdc.toFixed(2)} USDC</strong>
                        </p>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 text-[11px] font-mono rounded-md bg-surface border border-border text-purple-400 font-bold shrink-0">
                      {statusTag}
                    </span>
                  </div>

                  {/* Rejection Reason */}
                  <div className="p-3.5 rounded-lg bg-surface border border-border space-y-1 text-xs">
                    <span className="text-[10px] font-mono uppercase text-text-muted block">
                      Recruiter Rejection Reason
                    </span>
                    <p className="text-text-secondary leading-relaxed">
                      {dispute.rejectionReason}
                    </p>
                  </div>

                  {/* Live 2-of-3 Tally */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-purple-400 font-semibold">
                          Pay Candidate (Override)
                        </span>
                        <span className="text-text font-bold">
                          {dispute.votesForCandidate} / 2 Votes
                        </span>
                      </div>
                      <ProgressBar value={overridePct} color="purple" size="sm" />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-text-secondary font-semibold">
                          Uphold Rejection (Slash)
                        </span>
                        <span className="text-text font-bold">
                          {dispute.votesForRecruiter} / 2 Votes
                        </span>
                      </div>
                      <ProgressBar value={upholdPct} color="purple" size="sm" />
                    </div>
                  </div>

                  {/* Anonymized Evaluation Breakdown Drawer */}
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedDisputes((prev) => ({
                          ...prev,
                          [dispute.id]: !prev[dispute.id],
                        }))
                      }
                      className="text-xs font-mono text-purple-400 hover:underline cursor-pointer"
                    >
                      {isExpanded
                        ? "Hide Anonymized Evaluation Breakdown ↑"
                        : "Inspect Anonymized Evaluation Breakdown (PII-Redacted) ↓"}
                    </button>

                    {isExpanded && (
                      <div className="p-4 rounded-lg bg-surface border border-border space-y-4 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border/70">
                          <span className="font-mono font-bold text-text">
                            AI Committee Consensus: {dispute.anonymizedBreakdown.verdict || "Verified"} ({dispute.anonymizedBreakdown.overallScore}/100)
                          </span>
                          <span className="text-[11px] font-mono text-text-muted">
                            Ticket PDA: {dispute.disputeTicketPda.slice(0, 8)}...{dispute.disputeTicketPda.slice(-6)}
                          </span>
                        </div>
                        <p className="text-text-secondary leading-relaxed">
                          {dispute.anonymizedBreakdown.explanation}
                        </p>

                        {dispute.anonymizedBreakdown.agentSummaries.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                            {dispute.anonymizedBreakdown.agentSummaries.map((ag) => (
                              <div
                                key={ag.agentRole}
                                className="p-2.5 rounded-md bg-surface-elevated border border-border space-y-1"
                              >
                                <div className="flex items-center justify-between font-mono text-[11px]">
                                  <span className="text-text font-semibold uppercase">
                                    {ag.agentRole.replace(/_/g, " ")}
                                  </span>
                                  <span className="text-purple-400 font-bold">
                                    {ag.scoreContribution ?? "—"}/100
                                  </span>
                                </div>
                                {ag.position && (
                                  <p className="text-[11px] text-text-muted line-clamp-2">
                                    {ag.position}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {dispute.anonymizedBreakdown.strengths.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] font-mono uppercase text-purple-400 font-bold block">
                              Verified Strengths (Redacted)
                            </span>
                            <ul className="list-disc list-inside text-text-secondary space-y-0.5">
                              {dispute.anonymizedBreakdown.strengths.map((s, idx) => (
                                <li key={idx}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {dispute.anonymizedBreakdown.redFlags.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] font-mono uppercase text-red-400 font-bold block">
                              Recorded Red Flags
                            </span>
                            <ul className="list-disc list-inside text-text-secondary space-y-0.5">
                              {dispute.anonymizedBreakdown.redFlags.map((rf, idx) => (
                                <li key={idx}>
                                  <strong>{rf.flag}</strong>: {rf.evidenceSnippet}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Peer Juror Vote Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/70">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!canVote}
                        isLoading={busyDisputeKey === `${dispute.id}:pay`}
                        onClick={() => void handleCastJuryVote(dispute, true)}
                      >
                        Vote: Pay Candidate
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={!canVote}
                        isLoading={busyDisputeKey === `${dispute.id}:uphold`}
                        onClick={() => void handleCastJuryVote(dispute, false)}
                      >
                        Vote: Uphold Rejection
                      </Button>
                    </div>

                    <span className="text-[11px] font-mono text-text-muted">
                      {!isOpen
                        ? `Closed (${dispute.jurorWallets.length}/3 jurors voted)`
                        : dispute.isCurrentUserCandidate
                        ? "Disputed candidate cannot vote"
                        : dispute.isCurrentUserCreator
                        ? "Bounty creator cannot vote"
                        : dispute.hasCurrentUserVoted
                        ? "Your wallet already voted"
                        : !publicKey
                        ? "Connect wallet to vote"
                        : !data?.jurorEligibility?.eligible
                        ? "Requires SBT or Active Streak >= 1"
                        : `${dispute.jurorWallets.length}/3 jury seats filled`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

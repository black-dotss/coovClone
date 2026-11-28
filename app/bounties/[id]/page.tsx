"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ErrorPopup, SuccessPopup } from "@/components/ui/error-popup";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { BountyCompanyLogo } from "@/components/solana/bounty-company-logo";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";
import { apiFetch } from "@/lib/client/api";
import {
  captureScoutReferralFromSearch,
  getStoredScoutReferral,
} from "@/lib/solana/scout-referral";

interface BountyDetailItem {
  id: string;
  recruiterUserId: string;
  recruiterWallet: string;
  jobDescriptionId: string;
  title: string;
  company: string;
  companyLogoUrl?: string | null;
  escrowPdaAddress: string;
  minScore: number;
  minStreak?: number;
  rewardPerWinnerUsdc: number;
  candidate90Usdc?: number;
  scout10Usdc?: number;
  totalPoolUsdc: number;
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

interface BountiesDetailApiResponse {
  cluster: string;
  currentUserId: string | null;
  bounties: BountyDetailItem[];
  candidateReputation?: CandidateReputationSummary | null;
  disputes?: Array<{
    id: string;
    bountyId: string;
    status: string;
    votesForCandidate: number;
    votesForRecruiter: number;
    isCurrentUserCandidate: boolean;
  }>;
  mySubmissions?: Array<{
    bountyId: string;
    evaluationId: string;
    reviewStatus: string;
    fakeDetectorStatus: string;
  }>;
  myEvaluations?: Array<{
    id: string;
    jobDescriptionId: string;
    overallScore: number | null;
    evalTxSignature: string | null;
  }>;
}

export default function BountyDetailPage() {
  const params = useParams<{ id: string }>();
  const rawId = params?.id ?? "";
  const { publicKey, openConnectModal, signAndSubmitTx, clusterLabel } = useSolanaWallet();

  const [bounty, setBounty] = useState<BountyDetailItem | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [reputation, setReputation] = useState<CandidateReputationSummary | null>(null);
  const [myDispute, setMyDispute] = useState<{
    id: string;
    status: string;
    votesForCandidate: number;
    votesForRecruiter: number;
  } | null>(null);
  const [disputeEval, setDisputeEval] = useState<{
    id: string;
    overallScore: number;
    evalTxSignature: string | null;
  } | null>(null);
  const [openingDispute, setOpeningDispute] = useState(false);
  const [disputeNotice, setDisputeNotice] = useState<string | null>(null);
  const [scoutRef, setScoutRef] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    captureScoutReferralFromSearch(window.location.search, [rawId]);
    return getStoredScoutReferral([rawId], publicKey);
  });
  const [copiedScoutLink, setCopiedScoutLink] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const query = publicKey ? `?wallet=${encodeURIComponent(publicKey)}` : "";
        const res = await apiFetch<BountiesDetailApiResponse>(
          `/api/solana/bounties${query}`
        );
        if (!active) return;
        const match =
          res.bounties.find(
            (b) => b.id === rawId || b.jobDescriptionId === rawId
          ) ?? null;

        setBounty(match);
        setCurrentUserId(res.currentUserId);
        setReputation(res.candidateReputation ?? null);

        if (match) {
          const foundDispute =
            res.disputes?.find(
              (d) => d.bountyId === match.id && d.isCurrentUserCandidate
            ) ?? null;
          setMyDispute(foundDispute);

          const rejSub = res.mySubmissions?.find(
            (s) =>
              s.bountyId === match.id &&
              s.reviewStatus === "rejected" &&
              s.fakeDetectorStatus !== "flagged"
          );
          const matchingEv = rejSub
            ? res.myEvaluations?.find(
                (e) =>
                  e.id === rejSub.evaluationId && (e.overallScore ?? 0) >= 90
              )
            : null;
          setDisputeEval(
            matchingEv && typeof matchingEv.overallScore === "number"
              ? {
                  id: matchingEv.id,
                  overallScore: matchingEv.overallScore,
                  evalTxSignature: matchingEv.evalTxSignature,
                }
              : null
          );
        }

        if (match && typeof window !== "undefined") {
          const ids = [match.id, match.jobDescriptionId, rawId];
          captureScoutReferralFromSearch(window.location.search, ids);
          setScoutRef(getStoredScoutReferral(ids, publicKey));
        } else if (typeof window !== "undefined") {
          captureScoutReferralFromSearch(window.location.search, [rawId]);
          setScoutRef(getStoredScoutReferral([rawId], publicKey));
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load Solana bounty details."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [publicKey, rawId]);

  const handleCopyScoutLink = async () => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    if (!bounty || typeof window === "undefined") return;
    const url = `${window.location.origin}/bounties/${bounty.id}?ref=${encodeURIComponent(
      publicKey
    )}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedScoutLink(true);
      setTimeout(() => setCopiedScoutLink(false), 3000);
    } catch {
      setError("Could not copy link to clipboard.");
    }
  };

  if (loading && !bounty && !error) {
    return <FullPageLoading />;
  }

  if (!bounty) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 py-12 space-y-6">
        <ErrorPopup
          title="Bounty Notice"
          message={error}
          onDismiss={() => setError(null)}
        />
        <Link
          href="/bounties"
          className="text-xs font-mono text-text-muted hover:text-purple-400"
        >
          ← Back to Hiring Bounties
        </Link>
        <div className="rounded-xl border border-border bg-surface p-8 text-center space-y-3">
          <h1 className="text-xl font-extrabold text-text">Bounty Not Found</h1>
          <p className="text-xs sm:text-sm text-text-secondary">
            {error || "This hiring bounty could not be located on Solana Devnet."}
          </p>
        </div>
      </div>
    );
  }

  const isCreator = Boolean(currentUserId && currentUserId === bounty.recruiterUserId);
  const occupied = bounty.occupiedSlots ?? bounty.claimsCount;
  const fillPct =
    bounty.maxWinners > 0
      ? Math.min(100, Math.round((occupied / bounty.maxWinners) * 100))
      : 0;
  const stakePct = bounty.stakePercent ?? 10;
  const standardStakeUsdc =
    bounty.stakePerCandidateUsdc ?? (bounty.rewardPerWinnerUsdc * stakePct) / 100;
  const isZeroStakeVip = Boolean(reputation?.isZeroStakeVip);
  const requiredStreak = bounty.minStreak ?? 0;
  const activeStreak = reputation?.effectiveStreak ?? 0;
  const candidate90Usdc = bounty.candidate90Usdc ?? bounty.rewardPerWinnerUsdc * 0.9;
  const scout10Usdc = bounty.scout10Usdc ?? bounty.rewardPerWinnerUsdc * 0.1;

  const handleOpenDispute = async () => {
    if (!disputeEval) return;
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setOpeningDispute(true);
    setError(null);
    setDisputeNotice(null);
    try {
      if (!disputeEval.evalTxSignature) {
        const anchorPrep = await apiFetch<{ serializedTxBase64: string }>(
          `/api/solana/evaluations/${disputeEval.id}`,
          {
            method: "POST",
            body: JSON.stringify({ walletAddress: publicKey }),
          }
        );
        const anchorSig = await signAndSubmitTx(anchorPrep.serializedTxBase64);
        await apiFetch(`/api/solana/evaluations/${disputeEval.id}`, {
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
          evaluationId: disputeEval.id,
        }),
      });
      const sig = await signAndSubmitTx(prep.serializedTxBase64);
      const conf = await apiFetch<{
        dispute: {
          id: string;
          status: string;
          votesForCandidate: number;
          votesForRecruiter: number;
        };
      }>(`/api/solana/bounties/${bounty.id}/dispute`, {
        method: "PATCH",
        body: JSON.stringify({
          walletAddress: publicKey,
          evaluationId: disputeEval.id,
          txSignature: sig,
        }),
      });
      setMyDispute(conf.dispute);
      setDisputeNotice(
        `Opened On-Chain Jury Dispute (${prep.disputeTicketPda.slice(0, 8)}...)!`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to open On-Chain Jury Dispute."
      );
    } finally {
      setOpeningDispute(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <ErrorPopup
        title="Bounty Notice"
        message={error}
        onDismiss={() => setError(null)}
      />
      <SuccessPopup
        title="Confirmed"
        message={disputeNotice}
        onDismiss={() => setDisputeNotice(null)}
      />

      <div className="flex items-center justify-between">
        <Link
          href="/bounties"
          className="text-xs font-mono text-text-muted hover:text-purple-400 transition-colors"
        >
          ← All Hiring Bounties
        </Link>
        <span className="px-2.5 py-1 text-[11px] font-mono rounded-md bg-surface border border-border text-purple-400">
          Solana {clusterLabel} · USDC Escrow
        </span>
      </div>

      {scoutRef && (
        <div className="rounded-xl border border-purple-500/40 bg-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="space-y-0.5">
            <p className="font-bold text-purple-400 font-mono uppercase">
              Scout Referral Active (90 / 10 On-Chain Split)
            </p>
            <p className="text-text-secondary">
              Referred by Scout{" "}
              <span className="font-mono text-text">
                {scoutRef.slice(0, 6)}...{scoutRef.slice(-6)}
              </span>
              . On approval, you receive <strong>90%</strong> ({candidate90Usdc.toFixed(2)} USDC) + 100% refunded stake + bonus yield, and your Scout automatically receives{" "}
              <strong>10%</strong> ({scout10Usdc.toFixed(2)} USDC).
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-purple-300/60 dark:border-purple-500/20 bg-purple-50/45 dark:bg-purple-500/[0.045] p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-start gap-4 min-w-0">
            <BountyCompanyLogo
              company={bounty.company}
              logoUrl={bounty.companyLogoUrl}
              size="lg"
            />
            <div className="min-w-0 space-y-1">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-purple-400 block">
                {bounty.company}
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-text">
                {bounty.title}
              </h1>
              <p className="text-xs font-mono text-text-muted">
                Escrow PDA: {bounty.escrowPdaAddress}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopyScoutLink()}
          >
            {copiedScoutLink
              ? "Scout Link Copied!"
              : "Share & Earn 10% Scout Cut"}
          </Button>
        </div>

        {/* Economics & Trust Gates */}
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-lg bg-surface-elevated border border-border">
              <span className="text-[10px] font-mono text-text-muted uppercase block">
                Winner Reward
              </span>
              <p className="text-xl font-extrabold text-purple-400 mt-0.5 whitespace-nowrap">
                {bounty.rewardPerWinnerUsdc} USDC
              </p>
              <span className="text-[10px] font-mono text-text-muted block whitespace-nowrap">
                90/10 split: {candidate90Usdc.toFixed(2)} / {scout10Usdc.toFixed(2)} USDC
              </span>
            </div>

            <div className="p-4 rounded-lg bg-surface-elevated border border-border">
              <span className="text-[10px] font-mono text-text-muted uppercase block">
                Entry Bar
              </span>
              <p className="text-xl font-extrabold text-text mt-0.5 whitespace-nowrap">
                {bounty.minScore}/100
              </p>
              <span className="text-[10px] font-mono text-text-muted block">
                {requiredStreak > 0
                  ? `Min Streak: ${requiredStreak}+ (${activeStreak} yours)`
                  : "No min streak"}
              </span>
            </div>

            <div className="p-4 rounded-lg bg-surface-elevated border border-border">
              <span className="text-[10px] font-mono text-text-muted uppercase block">
                Conviction Stake
              </span>
              {isZeroStakeVip ? (
                <>
                  <p className="text-lg font-extrabold text-purple-400 mt-0.5 whitespace-nowrap">
                    0 USDC Stake
                  </p>
                  <span className="text-[10px] font-mono text-purple-400 block">
                    Verified Streak Perk
                  </span>
                </>
              ) : (
                <>
                  <p className="text-xl font-extrabold text-text mt-0.5 whitespace-nowrap">
                    {standardStakeUsdc.toFixed(2)} USDC
                  </p>
                  <span className="text-[10px] font-mono text-text-muted block">
                    {stakePct}% refundable
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-text-muted">
            <span>
              Slashed Spam Yield:{" "}
              <strong
                className={
                  (bounty.slashedPoolUsdc ?? 0) > 0
                    ? "text-purple-400"
                    : "text-text-secondary"
                }
              >
                +{(bounty.slashedPoolUsdc ?? 0).toFixed(2)} USDC
              </strong>
            </span>
            <span
              className={
                (bounty.proRataBonusUsdc ?? 0) > 0 ? "text-purple-400" : undefined
              }
            >
              +{(bounty.proRataBonusUsdc ?? 0).toFixed(2)} USDC / slot bonus
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-text-muted">
            <span>
              Slots: {bounty.claimsCount} paid · {bounty.pendingReviewCount} in review /{" "}
              {bounty.maxWinners} total
            </span>
            <span>Expires: {new Date(bounty.expiresAt).toLocaleDateString()}</span>
          </div>
          <ProgressBar value={fillPct} color="purple" size="sm" />
        </div>

        <div className="p-5 rounded-lg bg-surface-elevated border border-border space-y-2">
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-text-muted">
            Role Requirements
          </h2>
          <p className="text-xs sm:text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
            {bounty.rawText}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
          <div className="flex flex-wrap items-center gap-2.5">
            {isCreator ? (
              <Link href={`/bounties/${bounty.id}/review`}>
                <Button variant="primary" size="md">
                  Open Publisher Review Panel →
                </Button>
              </Link>
            ) : myDispute ? (
              <Link href="/bounties#active-jury-disputes">
                <Button variant="primary" size="md">
                  View Jury Dispute ({myDispute.votesForCandidate}/2 Override ·{" "}
                  {myDispute.votesForRecruiter}/2 Uphold) →
                </Button>
              </Link>
            ) : disputeEval && bounty.status === "active" && !bounty.isExpired ? (
              <Button
                type="button"
                variant="primary"
                size="md"
                isLoading={openingDispute}
                onClick={() => void handleOpenDispute()}
              >
                Open On-Chain Jury Dispute ({disputeEval.overallScore}/100) →
              </Button>
            ) : bounty.status === "active" && !bounty.isExpired && bounty.availableSlots > 0 ? (() => {
              const applyTarget = `/evaluations/new?bountyId=${bounty.id}${
                scoutRef ? `&ref=${encodeURIComponent(scoutRef)}` : ""
              }`;
              const applyHref = !currentUserId
                ? `/auth?callbackUrl=${encodeURIComponent(applyTarget)}`
                : applyTarget;
              return (
                <Link href={applyHref}>
                  <Button variant="primary" size="md">
                    {isZeroStakeVip
                      ? "Apply with 0 USDC Stake (Verified Streak Perk) →"
                      : `Apply & Stake ${standardStakeUsdc.toFixed(2)} USDC →`}
                  </Button>
                </Link>
              );
            })() : (
              <span className="px-3 py-1.5 text-xs font-mono rounded-md bg-surface-elevated border border-border text-text-muted">
                {bounty.isExpired ? "Bounty Expired" : "All Slots Filled / Closed"}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
            <a
              href={bounty.escrowUrl}
              target="_blank"
              rel="noreferrer"
              className="text-purple-400 hover:underline"
            >
              Inspect Escrow on Explorer →
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
        </div>
      </div>
    </div>
  );
}

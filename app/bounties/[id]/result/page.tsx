"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorPopup } from "@/components/ui/error-popup";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { BountyCompanyLogo } from "@/components/solana/bounty-company-logo";
import { apiFetch } from "@/lib/client/api";
import { executeBountyClaimFlow } from "@/lib/solana/client-claim";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";

interface BountyResultResponse {
  cluster: string;
  bounty: {
    id: string;
    title: string;
    company: string;
    companyLogoUrl?: string | null;
    minScore: number;
    maxWinners: number;
    rewardPerWinnerUsdc: number;
    stakePercent?: number;
    stakePerCandidateUsdc?: number;
    slashedPoolUsdc?: number;
    proRataBonusUsdc?: number;
    expiresAt: string;
  };
  evaluation: {
    id: string;
    status: string;
    overallScore: number | null;
    verdict: string | null;
    evalPdaAddress: string | null;
    evalTxSignature: string | null;
    evalTxUrl: string | null;
  } | null;
  submission: {
    id: string;
    reviewStatus: string;
    fakeDetectorStatus: string;
    fakeDetectorScore: number | null;
    recruiterNotes: string | null;
    stakePdaAddress?: string | null;
    stakeStatus?: string;
    isZeroStakeVip?: boolean;
    referrerWallet?: string | null;
    scoutCutUsdc?: number;
    stakeAmountUsdc?: number;
    bonusPaidUsdc?: number;
    remainingReviewLabel: string | null;
  } | null;
  restriction: {
    reason: string;
    details: string;
  } | null;
  claim: {
    txSignature: string;
    txUrl: string;
  } | null;
  dispute?: {
    id: string;
    disputeTicketPda: string;
    status: string;
    votesForCandidate: number;
    votesForRecruiter: number;
  } | null;
  spotSecured: number | null;
  metrics: {
    claimsCount: number;
    pendingReviewCount: number;
    approvedCount: number;
    occupiedSlots: number;
    availableSlots: number;
  };
}

function BountyResultContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const bountyId = params?.id as string;
  const evalId = searchParams?.get("evalId") || "";
  const { publicKey, openConnectModal, signAndSubmitTx } = useSolanaWallet();

  const [data, setData] = useState<BountyResultResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bountyId) return;
    let ignore = false;

    async function loadResult() {
      try {
        const qs = evalId ? `?evalId=${encodeURIComponent(evalId)}` : "";
        const res = await apiFetch<BountyResultResponse>(
          `/api/solana/bounties/${bountyId}/result${qs}`
        );
        if (!ignore) {
          setData(res);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load bounty result.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadResult();
    return () => {
      ignore = true;
    };
  }, [bountyId, evalId]);

  if (loading) {
    return <FullPageLoading />;
  }

  if (!data || !data.evaluation) {
    return (
      <div className="w-full max-w-2xl mx-auto px-4 py-12 space-y-6">
        <ErrorPopup
          title="Bounty Result Notice"
          message={error}
          onDismiss={() => setError(null)}
        />
        <div className="rounded-2xl border border-border bg-surface p-8 text-center space-y-4">
          <h1 className="text-xl font-extrabold text-text">Bounty Result Unavailable</h1>
          <p className="text-sm text-text-secondary">
            {error || "We could not find an evaluation record for this bounty."}
          </p>
          <Link href="/bounties">
            <Button variant="primary" size="md">
              Back to Bounties
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const score = data.evaluation.overallScore ?? 0;
  const minScore = data.bounty.minScore;
  const subStatus = data.submission?.reviewStatus;
  const isSuccess =
    !data.restriction &&
    (subStatus === "pending_review" ||
      subStatus === "approved" ||
      subStatus === "claimed" ||
      Boolean(data.claim));

  let statusHeadline = "Not Eligible";
  let statusDescription = `Your CV scored ${score}/100, which is below the ${minScore}/100 requirement.`;

  if (isSuccess) {
    if (data.claim || subStatus === "claimed") {
      statusHeadline = `Bounty Claimed · Spot #${data.spotSecured ?? 1} of ${data.bounty.maxWinners}`;
      statusDescription = `${data.bounty.rewardPerWinnerUsdc} USDC payout has been settled on-chain to your wallet.`;
    } else if (subStatus === "approved") {
      statusHeadline = `Approved · Spot #${data.spotSecured ?? 1} of ${data.bounty.maxWinners}`;
      statusDescription = `Publisher approved your submission. Your ${data.bounty.rewardPerWinnerUsdc} USDC payout is unlocked to claim on Bounties.`;
    } else {
      statusHeadline = `Spot #${data.spotSecured ?? 1} of ${data.bounty.maxWinners} Secured`;
      statusDescription = `You cleared the ${minScore}/100 bar. Your winner slot is reserved for the 24h publisher review window.`;
    }
  } else if (data.restriction) {
    statusHeadline = "Submission Restricted";
    statusDescription = data.restriction.details;
  } else if (score >= minScore && data.metrics.availableSlots <= 0) {
    statusHeadline = "All Winner Spots Filled";
    statusDescription = `Your CV scored ${score}/100, but all ${data.bounty.maxWinners} winner slots are already secured.`;
  } else if (subStatus === "rejected") {
    statusHeadline = "Submission Rejected";
    statusDescription =
      data.submission?.recruiterNotes ||
      "The publisher rejected this submission after review.";
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-6">
      <ErrorPopup
        title="Bounty Result Notice"
        message={error}
        onDismiss={() => setError(null)}
      />

      <Link
        href="/bounties"
        className="text-xs font-mono text-text-muted hover:text-purple-400 transition-colors inline-block"
      >
        ← Back to Bounties
      </Link>

      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-6">
        {/* Bounty Header */}
        <div className="flex items-center gap-3.5 pb-5 border-b border-border">
          <BountyCompanyLogo
            company={data.bounty.company}
            logoUrl={data.bounty.companyLogoUrl}
            size="lg"
          />
          <div className="min-w-0">
            <p className="text-xs font-mono text-text-muted truncate">
              {data.bounty.company}
            </p>
            <h1 className="text-lg sm:text-xl font-extrabold text-text truncate">
              {data.bounty.title}
            </h1>
          </div>
        </div>

        {/* Minimal Outcome Summary */}
        <div className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-wider text-purple-400 font-bold">
            {isSuccess ? "Qualified" : "Did Not Qualify"}
          </p>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-text tracking-tight">
            {statusHeadline}
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed">
            {statusDescription}
          </p>
        </div>

        {/* Minimal Key Metrics */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-4 rounded-xl bg-surface-elevated border border-border">
            <span className="text-[11px] font-mono text-text-muted uppercase block">
              Your Score
            </span>
            <span className="text-2xl font-extrabold text-purple-400 font-mono mt-1 block">
              {score}
              <span className="text-xs text-text-muted font-normal">/100</span>
            </span>
          </div>

          <div className="p-4 rounded-xl bg-surface-elevated border border-border">
            <span className="text-[11px] font-mono text-text-muted uppercase block">
              Spot Secured
            </span>
            <span className="text-2xl font-extrabold text-text font-mono mt-1 block">
              {isSuccess && data.spotSecured
                ? `#${data.spotSecured}`
                : "None"}
              <span className="text-xs text-text-muted font-normal">
                {isSuccess && data.spotSecured ? ` / ${data.bounty.maxWinners}` : ""}
              </span>
            </span>
          </div>

          <div className="p-4 rounded-xl bg-surface-elevated border border-border">
            <span className="text-[11px] font-mono text-text-muted uppercase block">
              Reward Pool
            </span>
            <span className="text-2xl font-extrabold text-text font-mono mt-1 block">
              {data.bounty.rewardPerWinnerUsdc}
              <span className="text-xs text-text-muted font-normal ml-1">USDC</span>
            </span>
          </div>
        </div>

        {isSuccess && data.submission?.remainingReviewLabel && !data.claim && (
          <div className="px-4 py-3 rounded-xl bg-surface-elevated border border-border flex items-center justify-between text-xs font-mono">
            <span className="text-text-muted">Review Window</span>
            <span className="text-purple-400 font-semibold">
              {data.submission.remainingReviewLabel}
            </span>
          </div>
        )}

          {data.submission?.stakeStatus && data.submission.stakeStatus !== "none" && (
            <div className="px-4 py-3 rounded-xl bg-surface-elevated border border-border flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <span className="text-text-muted">
                {data.submission.isZeroStakeVip
                  ? "0 USDC Stake (Verified Streak Perk)"
                  : `Conviction Stake (${data.submission.stakeAmountUsdc ?? data.bounty.stakePerCandidateUsdc ?? 0} USDC)`}
              </span>
              <span className="text-purple-400 font-semibold uppercase">
                {data.submission.stakeStatus}
                {(data.submission.bonusPaidUsdc ?? 0) > 0
                  ? ` (+${data.submission.bonusPaidUsdc} USDC spam yield)`
                  : (data.bounty.proRataBonusUsdc ?? 0) > 0 && isSuccess
                  ? ` (+${data.bounty.proRataBonusUsdc?.toFixed(2)} USDC est. yield)`
                  : ""}
              </span>
            </div>
          )}

          {data.submission?.referrerWallet && (
            <div className="px-4 py-3 rounded-xl bg-surface-elevated border border-border flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <span className="text-text-muted">
                Scout 90 / 10 Split Active ({data.submission.referrerWallet.slice(0, 6)}...
                {data.submission.referrerWallet.slice(-4)})
              </span>
              <span className="text-purple-400 font-semibold">
                {(data.bounty.rewardPerWinnerUsdc * 0.9).toFixed(2)} USDC Candidate ·{" "}
                {(data.bounty.rewardPerWinnerUsdc * 0.1).toFixed(2)} USDC Scout
              </span>
            </div>
          )}

          {claimNotice && (
            <div className="px-4 py-3 rounded-xl bg-surface-elevated border border-purple-500/40 text-xs font-mono text-purple-400">
              {claimNotice}
            </div>
          )}

          {/* Minimal Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
            {subStatus === "rejected" &&
              score >= 90 &&
              data.submission?.fakeDetectorStatus !== "flagged" &&
              (data.dispute ? (
                <Link href="/bounties#active-jury-disputes">
                  <Button variant="primary" size="md">
                    Dispute Jury ({data.dispute.votesForCandidate}/2 Override · {data.dispute.votesForRecruiter}/2 Uphold) →
                  </Button>
                </Link>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  isLoading={claiming}
                  onClick={async () => {
                    if (!publicKey) {
                      openConnectModal();
                      return;
                    }
                    setClaiming(true);
                    setError(null);
                    try {
                      if (!data.evaluation!.evalTxSignature) {
                        const anchorPrep = await apiFetch<{ serializedTxBase64: string }>(
                          `/api/solana/evaluations/${data.evaluation!.id}`,
                          {
                            method: "POST",
                            body: JSON.stringify({ walletAddress: publicKey }),
                          }
                        );
                        const anchorSig = await signAndSubmitTx(anchorPrep.serializedTxBase64);
                        await apiFetch(`/api/solana/evaluations/${data.evaluation!.id}`, {
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
                      }>(`/api/solana/bounties/${data.bounty.id}/dispute`, {
                        method: "POST",
                        body: JSON.stringify({
                          walletAddress: publicKey,
                          evaluationId: data.evaluation!.id,
                        }),
                      });
                      const sig = await signAndSubmitTx(prep.serializedTxBase64);
                      await apiFetch(`/api/solana/bounties/${data.bounty.id}/dispute`, {
                        method: "PATCH",
                        body: JSON.stringify({
                          walletAddress: publicKey,
                          evaluationId: data.evaluation!.id,
                          txSignature: sig,
                        }),
                      });
                      setClaimNotice(
                        `Opened On-Chain Jury Dispute (${prep.disputeTicketPda.slice(0, 8)}...)! 2-of-3 peer votes now override rejection.`
                      );
                      const qs = evalId ? `?evalId=${encodeURIComponent(evalId)}` : "";
                      const refreshed = await apiFetch<BountyResultResponse>(
                        `/api/solana/bounties/${bountyId}/result${qs}`
                      );
                      setData(refreshed);
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Failed to open On-Chain Jury Dispute."
                      );
                    } finally {
                      setClaiming(false);
                    }
                  }}
                >
                  Open On-Chain Jury Dispute →
                </Button>
              ))}
            {subStatus === "below_threshold" &&
              data.submission?.stakeStatus === "pending" &&
              !data.restriction && (
                <Button
                  variant="primary"
                  size="md"
                  isLoading={claiming}
                  onClick={async () => {
                    if (!publicKey) {
                      openConnectModal();
                      return;
                    }
                    setClaiming(true);
                    setError(null);
                    try {
                      const prep = await apiFetch<{
                        serializedTxBase64: string;
                        submissionId: string;
                      }>(`/api/solana/bounties/${data.bounty.id}/refund-stake`, {
                        method: "POST",
                        body: JSON.stringify({
                          walletAddress: publicKey,
                          submissionId: data.submission!.id,
                        }),
                      });
                      const sig = await signAndSubmitTx(prep.serializedTxBase64);
                      const conf = await apiFetch<{ amountRefundedUsdc: number }>(
                        `/api/solana/bounties/${data.bounty.id}/refund-stake`,
                        {
                          method: "PATCH",
                          body: JSON.stringify({
                            walletAddress: publicKey,
                            submissionId: prep.submissionId,
                            txSignature: sig,
                          }),
                        }
                      );
                      setClaimNotice(
                        `Refunded ${conf.amountRefundedUsdc} USDC Conviction Stake back to your wallet.`
                      );
                      const qs = evalId ? `?evalId=${encodeURIComponent(evalId)}` : "";
                      const refreshed = await apiFetch<BountyResultResponse>(
                        `/api/solana/bounties/${bountyId}/result${qs}`
                      );
                      setData(refreshed);
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : "Failed to reclaim stake."
                      );
                    } finally {
                      setClaiming(false);
                    }
                  }}
                >
                  Reclaim {data.submission.stakeAmountUsdc ?? 0} USDC Stake →
                </Button>
              )}
          {isSuccess &&
            !data.claim &&
            (subStatus === "approved" ||
              data.submission?.remainingReviewLabel === "Deadline expired (Auto-claim ready)") && (
              <Button
                variant="primary"
                size="md"
                isLoading={claiming}
                onClick={async () => {
                  if (!publicKey) {
                    openConnectModal();
                    return;
                  }
                  setClaiming(true);
                  setError(null);
                  try {
                    const res = await executeBountyClaimFlow({
                      bountyId: data.bounty.id,
                      evaluationId: data.evaluation!.id,
                      walletAddress: publicKey,
                      isEvalAnchored: Boolean(data.evaluation!.evalTxSignature),
                      signAndSubmitTx,
                    });
                    setClaimNotice(
                      `Claimed ${res.amountPaidUsdc} USDC payout! Tx: ${res.claimTxSignature}`
                    );
                    const qs = evalId ? `?evalId=${encodeURIComponent(evalId)}` : "";
                    const refreshed = await apiFetch<BountyResultResponse>(
                      `/api/solana/bounties/${bountyId}/result${qs}`
                    );
                    setData(refreshed);
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Failed to claim USDC bounty."
                    );
                  } finally {
                    setClaiming(false);
                  }
                }}
              >
                {data.evaluation.evalTxSignature
                  ? `Claim ${data.bounty.rewardPerWinnerUsdc} USDC →`
                  : `Anchor Proof & Claim ${data.bounty.rewardPerWinnerUsdc} USDC →`}
              </Button>
            )}
          <Link href={`/evaluations/${data.evaluation.id}/report`}>
            <Button variant={subStatus === "approved" && !data.claim ? "outline" : "primary"} size="md">
              {isSuccess && !data.evaluation.evalTxSignature
                ? "View Report & Anchor Proof →"
                : "View Full Report →"}
            </Button>
          </Link>
          <Link href="/bounties">
            <Button variant="outline" size="md">
              Go to Bounties
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function BountyResultPage() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <BountyResultContent />
    </Suspense>
  );
}

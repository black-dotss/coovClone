"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { apiFetch } from "@/lib/client/api";
import { useSession } from "@/lib/auth/auth-client";
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

interface BountiesApiResponse {
  cluster: string;
  currentUserId: string | null;
  bounties: BountyItem[];
  myEvaluations: CandidateEvalSummary[];
  myClaims: CandidateClaimSummary[];
}

export default function BountiesPage() {
  const { data: session } = useSession();
  const { publicKey, openConnectModal, signAndSubmitTx, clusterLabel } =
    useSolanaWallet();

  const [data, setData] = useState<BountiesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create Bounty Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [minScore, setMinScore] = useState("85");
  const [rewardPerWinner, setRewardPerWinner] = useState("20");
  const [maxWinners, setMaxWinners] = useState("5");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [rawText, setRawText] = useState("");

  // Action loading states keyed by bounty id
  const [busyBountyId, setBusyBountyId] = useState<string | null>(null);

  const loadBounties = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<BountiesApiResponse>("/api/solana/bounties");
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load Solana USDC bounties."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiFetch<BountiesApiResponse>("/api/solana/bounties");
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
  }, []);

  const handleCreateBounty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      setError("Sign in first to fund and publish a USDC bounty escrow.");
      return;
    }
    if (!publicKey) {
      openConnectModal();
      return;
    }

    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const prepared = await apiFetch<{
        jobDescriptionId: string;
        serializedTxBase64: string;
        escrowPda: string;
      }>("/api/solana/bounties", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          company: company.trim(),
          rawText: rawText.trim(),
          recruiterWallet: publicKey,
          minScore: Number(minScore),
          rewardPerWinnerUsdc: Number(rewardPerWinner),
          maxWinners: Number(maxWinners),
          expiresInDays: Number(expiresInDays),
        }),
      });

      const txSignature = await signAndSubmitTx(prepared.serializedTxBase64);

      await apiFetch("/api/solana/bounties", {
        method: "PATCH",
        body: JSON.stringify({
          jobDescriptionId: prepared.jobDescriptionId,
          recruiterWallet: publicKey,
          title: title.trim(),
          company: company.trim(),
          txSignature,
        }),
      });

      setShowCreateModal(false);
      setTitle("");
      setCompany("");
      setRawText("");
      setNotice(
        "Funded and launched USDC Bounty Escrow on Solana Devnet!"
      );
      await loadBounties();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fund bounty escrow."
      );
    } finally {
      setCreating(false);
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
      setError(err instanceof Error ? err.message : "Failed to claim USDC bounty.");
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
      setError(
        err instanceof Error ? err.message : "Failed to withdraw expired escrow."
      );
    } finally {
      setBusyBountyId(null);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-text">
              On-Chain USDC Hiring Bounties
            </h1>
            <Badge variant="purple" size="sm">
              Solana {clusterLabel}
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-text-secondary max-w-2xl">
            Recruiters lock Devnet Circle USDC in program-controlled escrow PDAs.
            Candidates who score at or above the threshold and anchor their COOV
            proof claim USDC payouts trustlessly.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {!publicKey && (
            <Button variant="outline" size="sm" onClick={openConnectModal}>
              Connect Wallet
            </Button>
          )}
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setError(null);
              setShowCreateModal(true);
            }}
          >
            + Post USDC Bounty Escrow
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger" title="Bounty Notice">
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
        <div className="rounded-2xl border border-border bg-surface p-10 text-center space-y-4">
          <h2 className="text-lg font-bold text-text">No Active Bounties Yet</h2>
          <p className="text-xs sm:text-sm text-text-secondary max-w-md mx-auto">
            Launch the first verifiable hiring bounty by locking Devnet USDC into an
            on-chain escrow vault for top-scoring candidates.
          </p>
          <Button variant="primary" size="md" onClick={() => setShowCreateModal(true)}>
            Create First USDC Bounty
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.bounties.map((bounty) => {
            const fillPct =
              bounty.maxWinners > 0
                ? Math.round((bounty.claimsCount / bounty.maxWinners) * 100)
                : 0;
            const myClaim = data.myClaims.find((c) => c.bountyId === bounty.id);
            const matchingEvals = data.myEvaluations.filter(
              (ev) => ev.jobDescriptionId === bounty.jobDescriptionId && ev.status === "completed"
            );
            const claimableEval = matchingEvals.find(
              (ev) =>
                ev.evalTxSignature &&
                typeof ev.overallScore === "number" &&
                ev.overallScore >= bounty.minScore
            );
            const unanchoredQualifying = matchingEvals.find(
              (ev) =>
                !ev.evalTxSignature &&
                typeof ev.overallScore === "number" &&
                ev.overallScore >= bounty.minScore
            );
            const isExpired = bounty.isExpired;
            const isCreator =
              Boolean(data.currentUserId) &&
              data.currentUserId === bounty.recruiterUserId;

            return (
              <div
                key={bounty.id}
                className="rounded-2xl border border-border bg-surface p-6 space-y-5 flex flex-col justify-between shadow-xs"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-mono text-purple-400 font-semibold">
                        {bounty.company}
                      </span>
                      <h3 className="text-lg font-bold text-text mt-0.5">
                        {bounty.title}
                      </h3>
                    </div>
                    <Badge
                      variant={
                        bounty.status === "active"
                          ? "success"
                          : bounty.status === "filled"
                          ? "purple"
                          : "warning"
                      }
                      size="sm"
                    >
                      {bounty.status.toUpperCase()}
                    </Badge>
                  </div>

                  {/* Pool & Threshold Metrics */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="p-3 rounded-xl bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase">
                        Reward / Winner
                      </span>
                      <p className="text-base font-extrabold text-emerald-400 mt-0.5">
                        {bounty.rewardPerWinnerUsdc} USDC
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-surface-elevated border border-border">
                      <span className="text-[10px] font-mono text-text-muted uppercase">
                        Min Score
                      </span>
                      <p className="text-base font-extrabold text-text mt-0.5">
                        {bounty.minScore}/100
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-surface-elevated border border-border">
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
                        Winner Slots: {bounty.claimsCount} / {bounty.maxWinners} claimed
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
                        className="text-emerald-400 hover:underline"
                      >
                        Funding Tx →
                      </a>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {myClaim ? (
                      <Badge variant="success" size="md">
                        Claimed {Number(myClaim.amountMicros) / 1_000_000} USDC
                      </Badge>
                    ) : claimableEval && bounty.status === "active" && !isExpired ? (
                      <Button
                        variant="primary"
                        size="sm"
                        isLoading={busyBountyId === bounty.id}
                        onClick={() => void handleClaim(bounty, claimableEval.id)}
                      >
                        Claim {bounty.rewardPerWinnerUsdc} USDC ({claimableEval.overallScore}/100)
                      </Button>
                    ) : unanchoredQualifying ? (
                      <Link href={`/evaluations/${unanchoredQualifying.id}/report`}>
                        <Button variant="secondary" size="sm">
                          Anchor Proof ({unanchoredQualifying.overallScore}/100) to Claim →
                        </Button>
                      </Link>
                    ) : bounty.status === "active" && !isExpired ? (
                      <Link href={`/evaluations/new?bountyId=${bounty.id}`}>
                        <Button variant="primary" size="sm">
                          Apply & Evaluate CV →
                        </Button>
                      </Link>
                    ) : null}

                    {isCreator && isExpired && bounty.status !== "refunded" && (
                      <Button
                        variant="outline"
                        size="sm"
                        isLoading={busyBountyId === bounty.id}
                        onClick={() => void handleRefund(bounty)}
                      >
                        Withdraw Expired Escrow USDC
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Bounty Escrow Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Fund USDC Bounty Escrow on Solana Devnet"
        description="Deposits Devnet USDC into a program-controlled PDA vault. Qualified candidates scoring >= Min Score can claim automatically."
      >
        <form onSubmit={handleCreateBounty} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Role Title"
              placeholder="e.g. Senior Rust Engineer"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <Input
              label="Company / Team"
              placeholder="e.g. Solana Labs"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Input
              label="Min Score"
              type="number"
              min={50}
              max={100}
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              required
            />
            <Input
              label="USDC / Winner"
              type="number"
              step="0.01"
              min={0.01}
              value={rewardPerWinner}
              onChange={(e) => setRewardPerWinner(e.target.value)}
              required
            />
            <Input
              label="Max Winners"
              type="number"
              min={1}
              max={100}
              value={maxWinners}
              onChange={(e) => setMaxWinners(e.target.value)}
              required
            />
            <Input
              label="Expires (Days)"
              type="number"
              min={1}
              max={180}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              required
            />
          </div>

          <div className="p-3 rounded-lg bg-surface-elevated border border-border text-xs font-mono flex items-center justify-between">
            <span className="text-text-muted">Total Escrow Deposit:</span>
            <span className="font-bold text-emerald-400">
              {((Number(rewardPerWinner) || 0) * (Number(maxWinners) || 0)).toFixed(2)}{" "}
              USDC (Devnet)
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text">
              Role Job Description *
            </label>
            <Textarea
              rows={5}
              placeholder="Paste full technical requirements and responsibilities..."
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCreateModal(false)}
            >
              Cancel
            </Button>
            {!publicKey ? (
              <Button type="button" variant="primary" size="sm" onClick={openConnectModal}>
                Connect Wallet to Fund
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="sm" isLoading={creating}>
                Deposit & Create Escrow
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}

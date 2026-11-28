"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ErrorPopup, SuccessPopup } from "@/components/ui/error-popup";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { SolanaIdentityCard } from "@/components/solana/solana-identity-card";
import { apiFetch } from "@/lib/client/api";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";

interface OnChainProfileData {
  wallet: string;
  evalCount: number;
  highestScore: number;
  topSkills: string[];
  lastRoleTitle: string;
  updatedAt: number;
}

interface CredentialData {
  mint: string;
  tokenAccount: string;
  name: string;
  symbol: string;
  uri: string;
  roleTitle: string | null;
  scoreTier: string | null;
  evalId: string | null;
  reportHash: string | null;
  issuedAt: string | null;
  explorerUrl: string;
}

interface OnChainReputationData {
  wallet: string;
  lastVerifiedAt: number;
  verifiedStreak: number;
  effectiveStreak: number;
  totalEarnedUsdcMicros: string;
  totalEarnedUsdc: number;
  fraudFlags: number;
  isFresh: boolean;
  isZeroStakeVip: boolean;
  decayExpiresAt: number | null;
  daysUntilDecay: number | null;
}

interface ReadyEvaluationItem {
  id: string;
  roleTitle: string;
  company: string | null;
  overallScore: number;
  evalTxSignature: string | null;
  sbtMintAddress: string | null;
  sbtEligible: boolean;
  createdAt: string;
}

interface WalletStatusResponse {
  cluster: string;
  linkedWallet: string | null;
  walletVerifiedAt: string | null;
  profilePdaAddress: string | null;
  reputationPdaAddress?: string | null;
  profileTxSignature: string | null;
  explorerProfileUrl: string | null;
  onChainProfile: OnChainProfileData | null;
  onChainReputation?: OnChainReputationData | null;
  credentials: CredentialData[];
  onChainError: string | null;
  completedEvaluationsCount?: number;
  bestCompletedScore?: number;
  bestCompletedRoleTitle?: string | null;
  readyEvaluations?: ReadyEvaluationItem[];
}

export const ProfileOnChainPanel: React.FC = () => {
  const { publicKey, openConnectModal, signMessageText, signAndSubmitTx, clusterLabel } =
    useSolanaWallet();

  const [data, setData] = useState<WalletStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [busyEvalKey, setBusyEvalKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchWalletState = useCallback(async (): Promise<WalletStatusResponse> => {
    const query = publicKey ? `?wallet=${encodeURIComponent(publicKey)}` : "";
    return apiFetch<WalletStatusResponse>(`/api/solana/wallet${query}`);
  }, [publicKey]);

  const loadWalletState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWalletState();
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load Solana identity state."
      );
    } finally {
      setLoading(false);
    }
  }, [fetchWalletState]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchWalletState();
        if (active) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load Solana identity state."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchWalletState]);

  const handleLinkWallet = async () => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setLinking(true);
    setError(null);
    setSuccess(null);
    try {
      const challenge = await apiFetch<{ message: string; walletAddress: string }>(
        "/api/solana/wallet",
        {
          method: "POST",
          body: JSON.stringify({
            action: "challenge",
            walletAddress: publicKey,
          }),
        }
      );

      const signed = await signMessageText(challenge.message);

      await apiFetch("/api/solana/wallet", {
        method: "POST",
        body: JSON.stringify({
          action: "link",
          walletAddress: publicKey,
          message: challenge.message,
          signatureBase64: signed.signatureBase64,
        }),
      });

      setSuccess(
        `Verified & linked Solana wallet ${publicKey.slice(0, 6)}...${publicKey.slice(-4)} to your COOV account.`
      );
      await loadWalletState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link Solana wallet.");
    } finally {
      setLinking(false);
    }
  };

  const handleUnlinkWallet = async () => {
    setUnlinking(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch("/api/solana/wallet", { method: "DELETE" });
      setSuccess("Solana wallet unlinked from your COOV profile.");
      await loadWalletState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlink wallet.");
    } finally {
      setUnlinking(false);
    }
  };

  const handleAnchorEvaluation = async (ev: ReadyEvaluationItem) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setBusyEvalKey(`anchor:${ev.id}`);
    setError(null);
    setSuccess(null);
    try {
      const prepared = await apiFetch<{
        serializedTxBase64: string;
        evalPda: string;
      }>(`/api/solana/evaluations/${ev.id}`, {
        method: "POST",
        body: JSON.stringify({ walletAddress: publicKey, action: "auto" }),
      });
      const txSignature = await signAndSubmitTx(prepared.serializedTxBase64);
      await apiFetch(`/api/solana/evaluations/${ev.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          walletAddress: publicKey,
          txSignature,
        }),
      });
      setSuccess(
        `Anchored #${ev.id.slice(0, 8)} (${ev.overallScore}/100) to Solana ${clusterLabel}.`
      );
      await loadWalletState();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to anchor evaluation on Solana."
      );
    } finally {
      setBusyEvalKey(null);
    }
  };

  const handleMintEvaluationSbt = async (ev: ReadyEvaluationItem) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setBusyEvalKey(`mint:${ev.id}`);
    setError(null);
    setSuccess(null);
    try {
      const prepared = await apiFetch<{
        serializedTxBase64: string;
        sbtMintAddress: string;
      }>(`/api/solana/evaluations/${ev.id}/mint-sbt`, {
        method: "POST",
        body: JSON.stringify({ walletAddress: publicKey }),
      });
      const txSignature = await signAndSubmitTx(prepared.serializedTxBase64);
      await apiFetch(`/api/solana/evaluations/${ev.id}/mint-sbt`, {
        method: "PATCH",
        body: JSON.stringify({
          walletAddress: publicKey,
          txSignature,
          sbtMintAddress: prepared.sbtMintAddress,
        }),
      });
      setSuccess(
        `Minted Token-2022 Soulbound Credential for #${ev.id.slice(0, 8)} (${ev.overallScore}/100)!`
      );
      await loadWalletState();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to mint Soulbound Credential."
      );
    } finally {
      setBusyEvalKey(null);
    }
  };

  if (loading && !data) {
    return <FullPageLoading />;
  }

  const activeWallet = data?.linkedWallet || publicKey;
  const rep = data?.onChainReputation;
  const profile = data?.onChainProfile;
  const completedCount = data?.completedEvaluationsCount ?? 0;
  const bestCompletedScore = data?.bestCompletedScore ?? 0;
  const readyEvals = data?.readyEvaluations ?? [];
  const actionableEvals = readyEvals.filter(
    (ev) => !ev.evalTxSignature || (ev.sbtEligible && !ev.sbtMintAddress)
  );
  const displayScore = profile?.highestScore ?? bestCompletedScore;
  const isShowingUnanchoredScore = !profile && bestCompletedScore > 0;

  const reputationStatusLabel =
    rep && rep.fraudFlags > 0
      ? `Fraud Penalty (${rep.fraudFlags} flag${rep.fraudFlags === 1 ? "" : "s"})`
      : rep?.isZeroStakeVip
      ? "Zero-Stake VIP Unlocked (0 USDC Stake)"
      : rep?.isFresh
      ? `Active Streak · ${rep.daysUntilDecay ?? 0}d left before decay`
      : rep && rep.verifiedStreak > 0
      ? "Streak Decayed (>30 days idle — re-verify to restore)"
      : "Score 75+ twice within 30 days to unlock 0 USDC Stake";

  return (
    <div className="space-y-8">
      <ErrorPopup
        title="Solana Error"
        message={error}
        onDismiss={() => setError(null)}
      />
      <SuccessPopup
        title="Wallet & Proof Confirmed"
        message={success}
        onDismiss={() => setSuccess(null)}
      />
      {data?.onChainError && (
        <Alert variant="warning" title="RPC Notice">
          {data.onChainError}
        </Alert>
      )}

      {/* Main Two-Column Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Portrait Scorecard */}
        <div className="lg:col-span-5">
          <SolanaIdentityCard
            badgeLabel={
              data?.credentials?.length
                ? `${data.credentials.length} SBT Minted`
                : profile
                ? "On-Chain ID"
                : completedCount > 0
                ? "Ready to Anchor"
                : "Candidate ID"
            }
            clusterLabel={clusterLabel}
            roleTitle={
              profile?.lastRoleTitle ||
              data?.bestCompletedRoleTitle ||
              "Solana Verified Candidate"
            }
            score={displayScore}
            scoreTier={
              profile
                ? `${profile.evalCount} Anchored Audit${profile.evalCount === 1 ? "" : "s"}`
                : completedCount > 0
                ? `${completedCount} Completed · Anchor Below`
                : "Pending Review"
            }
            verifiedSkills={profile?.topSkills ?? []}
            subtitle={
              rep && rep.effectiveStreak > 0
                ? `Streak ${rep.effectiveStreak}x · ${rep.totalEarnedUsdc.toFixed(2)} USDC`
                : completedCount > 0 && !profile
                ? `Best Review ${bestCompletedScore}/100 · Unanchored`
                : null
            }
            issuedLabel={
              rep?.isZeroStakeVip
                ? "Zero-Stake VIP"
                : data?.linkedWallet
                ? "Wallet Verified"
                : "Link Wallet"
            }
            onFooterAction={
              data?.linkedWallet
                ? undefined
                : publicKey
                ? () => void handleLinkWallet()
                : openConnectModal
            }
            downloadFileName="coov-solana-profile-card.png"
            onDownloadError={(msg) => setError(msg)}
          />
        </div>

        {/* Right: Simple Bold Cards */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card 1: Wallet & On-Chain PDAs */}
          <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-black text-text">
                  Verified Wallet
                </h2>
                <span className="px-3 py-1 text-xs font-mono font-bold rounded-lg bg-surface-elevated border border-border text-purple-400">
                  {data?.linkedWallet ? "Verified" : activeWallet ? "Connected" : "Not Linked"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadWalletState()}
                  disabled={loading}
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </Button>
                {!publicKey && (
                  <Button variant="primary" size="sm" onClick={openConnectModal}>
                    Connect Wallet
                  </Button>
                )}
                {publicKey && data?.linkedWallet !== publicKey && (
                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={linking}
                    onClick={() => void handleLinkWallet()}
                  >
                    Sign &amp; Link Wallet
                  </Button>
                )}
                {data?.linkedWallet && (
                  <Button
                    variant="outline"
                    size="sm"
                    isLoading={unlinking}
                    onClick={() => void handleUnlinkWallet()}
                  >
                    Unlink
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-border">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-text-secondary block mb-1">
                  Solana Wallet Address ({clusterLabel})
                </span>
                <p className="font-mono text-sm sm:text-base font-bold text-text break-all">
                  {activeWallet || "No wallet connected — connect Phantom or Solflare."}
                </p>
              </div>

              {(data?.profilePdaAddress || data?.reputationPdaAddress) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  {data?.profilePdaAddress && (
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-text-secondary block mb-1">
                        Profile PDA
                      </span>
                      {data.explorerProfileUrl ? (
                        <a
                          href={data.explorerProfileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs sm:text-sm font-semibold text-purple-400 hover:underline break-all"
                        >
                          {data.profilePdaAddress}
                        </a>
                      ) : (
                        <p className="font-mono text-xs sm:text-sm text-purple-400 break-all">
                          {data.profilePdaAddress}
                        </p>
                      )}
                    </div>
                  )}
                  {data?.reputationPdaAddress && (
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-text-secondary block mb-1">
                        Reputation PDA
                      </span>
                      <p className="font-mono text-xs sm:text-sm font-semibold text-purple-400 break-all">
                        {data.reputationPdaAddress}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Big Bold Standing Stats */}
          <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-5">
            <div className="space-y-1">
              <h2 className="text-2xl font-black text-text">
                On-Chain Standing
              </h2>
              <p
                className={`text-sm font-medium ${
                  rep && rep.fraudFlags > 0
                    ? "text-red-400"
                    : rep?.isZeroStakeVip
                    ? "text-purple-400 font-semibold"
                    : "text-text-secondary"
                }`}
              >
                {reputationStatusLabel}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-5 rounded-xl bg-surface-elevated border border-border">
                <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-text-secondary block">
                  Highest Score
                </span>
                <p className="text-3xl sm:text-4xl font-black text-purple-400 mt-2 font-mono">
                  {displayScore}
                  <span className="text-lg sm:text-xl text-text-muted font-bold">/100</span>
                </p>
                {isShowingUnanchoredScore && (
                  <p className="text-xs font-mono text-text-secondary mt-1">
                    In History · Ready to anchor
                  </p>
                )}
              </div>

              <div className="p-5 rounded-xl bg-surface-elevated border border-border">
                <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-text-secondary block">
                  Verified Streak
                </span>
                <p className="text-3xl sm:text-4xl font-black text-text mt-2 font-mono">
                  {rep?.effectiveStreak ?? 0}x
                </p>
              </div>

              <div className="p-5 rounded-xl bg-surface-elevated border border-border">
                <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-text-secondary block">
                  Bounty Earned
                </span>
                <p className="text-3xl sm:text-4xl font-black text-text mt-2 font-mono">
                  {(rep?.totalEarnedUsdc ?? 0).toFixed(2)}{" "}
                  <span className="text-base sm:text-lg text-text-muted font-bold">USDC</span>
                </p>
              </div>

              <div className="p-5 rounded-xl bg-surface-elevated border border-border">
                <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-text-secondary block">
                  Anchored Reviews
                </span>
                <p className="text-3xl sm:text-4xl font-black text-text mt-2 font-mono">
                  {profile?.evalCount ?? 0}
                </p>
                <p
                  className={`text-xs font-mono mt-1 ${
                    (rep?.fraudFlags ?? 0) > 0
                      ? "text-red-400 font-bold"
                      : "text-text-secondary"
                  }`}
                >
                  {completedCount > 0
                    ? `${completedCount} completed in History`
                    : `${rep?.fraudFlags ?? 0} Fraud Flags`}
                </p>
              </div>
            </div>
          </div>

          {/* Card 3: Anchor Completed Reviews / Verified Skills */}
          {actionableEvals.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-text">
                    Publish Completed Reviews to Solana
                  </h3>
                  <p className="text-sm text-text-secondary mt-1">
                    Anchor completed reviews on-chain to update your profile PDA and mint SBTs (85/100+).
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {actionableEvals.slice(0, 4).map((ev) => {
                  const anchored = Boolean(ev.evalTxSignature);
                  const anchoringThis = busyEvalKey === `anchor:${ev.id}`;
                  const mintingThis = busyEvalKey === `mint:${ev.id}`;
                  return (
                    <div
                      key={ev.id}
                      className="p-4 sm:p-5 rounded-xl bg-surface-elevated border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-purple-400">
                            #{ev.id.slice(0, 8)}
                          </span>
                          <span className="text-sm font-extrabold text-text truncate">
                            {ev.roleTitle}
                          </span>
                          {ev.sbtEligible && (
                            <span className="px-2 py-0.5 text-[11px] font-mono font-bold rounded-md bg-surface border border-border text-purple-400">
                              SBT Eligible
                            </span>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm font-mono text-text-secondary">
                          Score: <strong className="text-text">{ev.overallScore}/100</strong> ·{" "}
                          {anchored ? "Anchored on Solana" : "Not yet anchored on Solana"}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {!anchored ? (
                          <Button
                            variant="primary"
                            size="sm"
                            isLoading={anchoringThis}
                            onClick={() => void handleAnchorEvaluation(ev)}
                          >
                            {publicKey ? "Anchor On-Chain →" : "Connect Wallet →"}
                          </Button>
                        ) : ev.sbtEligible && !ev.sbtMintAddress ? (
                          <Button
                            variant="primary"
                            size="sm"
                            isLoading={mintingThis}
                            onClick={() => void handleMintEvaluationSbt(ev)}
                          >
                            Mint Token-2022 SBT →
                          </Button>
                        ) : null}
                        <Link href={`/evaluations/${ev.id}/report`}>
                          <Button variant="outline" size="sm">
                            Report →
                          </Button>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Card 4: Verified Skills & Latest Role */}
          <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-text-secondary block">
                  Latest Audited Role
                </span>
                <h3 className="text-xl sm:text-2xl font-black text-text mt-1">
                  {profile?.lastRoleTitle || data?.bestCompletedRoleTitle || "No Anchored Audits Yet"}
                </h3>
              </div>
              {data?.explorerProfileUrl && (
                <a
                  href={data.explorerProfileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-bold text-purple-400 hover:underline shrink-0"
                >
                  Inspect on Explorer →
                </a>
              )}
            </div>

            {profile && profile.topSkills.length > 0 ? (
              <div className="pt-2 flex flex-wrap gap-2">
                {profile.topSkills.map((skill) => (
                  <span
                    key={skill}
                    className="px-3.5 py-1.5 text-sm font-semibold rounded-lg bg-surface-elevated border border-border text-text"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <div className="p-5 rounded-xl bg-surface-elevated border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <p className="text-sm text-text-secondary">
                  {actionableEvals.length > 0
                    ? "Anchor one of your completed evaluations above to populate your verified on-chain skills."
                    : "Complete a CV review first, then anchor its proof onto Solana Devnet."}
                </p>
                <Link href={actionableEvals.length > 0 ? "/evaluations" : "/evaluations/new"} className="shrink-0">
                  <Button variant="outline" size="md">
                    {actionableEvals.length > 0 ? "Go to History →" : "Start New Review →"}
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Section: Token-2022 Non-Transferable Soulbound Credentials */}
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-5">
          <div>
            <h2 className="text-2xl sm:text-3xl font-black text-text">
              Soulbound Credentials (Token-2022 SBT)
            </h2>
            <p className="text-sm sm:text-base text-text-secondary mt-1">
              Permanent non-transferable credentials minted for evaluations scoring 85/100 or higher.
            </p>
          </div>
          <span className="px-3.5 py-1.5 text-sm font-mono font-bold rounded-lg bg-surface-elevated border border-border text-purple-400 shrink-0 self-start sm:self-auto">
            {data?.credentials.length || 0} Minted
          </span>
        </div>

        {!data?.credentials || data.credentials.length === 0 ? (
          <div className="p-8 sm:p-10 rounded-xl bg-surface-elevated border border-border text-center space-y-3">
            <p className="text-lg font-extrabold text-text">No Soulbound Credentials Yet</p>
            <p className="text-sm sm:text-base text-text-secondary max-w-xl mx-auto">
              Score 85/100 or higher on any COOV review, anchor it to Solana above or from your report, and mint your permanent Token-2022 SBT.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {data.credentials.map((cred) => (
              <div
                key={cred.mint}
                className="p-6 sm:p-7 rounded-2xl border border-border bg-surface-elevated space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-1 text-xs font-mono font-bold rounded-md bg-surface border border-border text-purple-400">
                        {cred.symbol || "COOV-SBT"}
                      </span>
                      <span className="px-2.5 py-1 text-xs font-mono font-semibold rounded-md bg-surface border border-border text-text-secondary">
                        Soulbound
                      </span>
                    </div>
                    <h4 className="text-xl font-black text-text">
                      {cred.roleTitle || cred.name}
                    </h4>
                  </div>
                  {cred.scoreTier && (
                    <span className="px-3 py-1 text-sm font-mono font-black rounded-lg bg-surface border border-border text-purple-400 shrink-0">
                      {cred.scoreTier}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 text-xs sm:text-sm font-mono text-text-secondary">
                  <p className="truncate">Mint: {cred.mint}</p>
                  {cred.reportHash && (
                    <p className="truncate">SHA-256: {cred.reportHash}</p>
                  )}
                </div>

                <div className="pt-3 border-t border-border flex items-center justify-between">
                  <a
                    href={cred.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-bold text-purple-400 hover:underline"
                  >
                    Inspect Mint →
                  </a>
                  {cred.evalId && (
                    <Link
                      href={`/evaluations/${cred.evalId}/report`}
                      className="text-sm font-bold text-text hover:text-purple-400"
                    >
                      Open Report →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

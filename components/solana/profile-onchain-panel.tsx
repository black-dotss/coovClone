"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
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

interface WalletStatusResponse {
  cluster: string;
  linkedWallet: string | null;
  walletVerifiedAt: string | null;
  profilePdaAddress: string | null;
  profileTxSignature: string | null;
  explorerProfileUrl: string | null;
  onChainProfile: OnChainProfileData | null;
  credentials: CredentialData[];
  onChainError: string | null;
}

export const ProfileOnChainPanel: React.FC = () => {
  const { publicKey, openConnectModal, signMessageText, clusterLabel } =
    useSolanaWallet();

  const [data, setData] = useState<WalletStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
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

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-extrabold text-text">
                On-Chain Identity & Skill Registry
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-mono rounded-md bg-surface-elevated border border-border text-purple-400">
                Solana {clusterLabel}
              </span>
            </div>
            <p className="text-xs text-text-secondary mt-1">
              Link Phantom or Solflare to publish verified committee scores and mint Token-2022 Soulbound credentials.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadWalletState()}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>

        {error && (
          <Alert variant="danger" title="Solana Error">
            {error}
          </Alert>
        )}
        {success && (
          <Alert variant="success" title="Wallet Verified">
            {success}
          </Alert>
        )}
        {data?.onChainError && (
          <Alert variant="warning" title="RPC Notice">
            {data.onChainError}
          </Alert>
        )}

        {loading ? (
          <div className="py-10 flex justify-center">
            <LoadingSpinner label="Querying Solana PDA & Token-2022 state..." />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Wallet Linking Controls */}
            <div className="p-4 rounded-lg bg-surface-elevated border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-text-muted">
                    Linked Wallet
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface border border-border text-purple-400">
                    {data?.linkedWallet ? "Verified" : "Not Linked"}
                  </span>
                </div>
                {data?.linkedWallet ? (
                  <p className="font-mono text-xs sm:text-sm text-text break-all">
                    {data.linkedWallet}
                  </p>
                ) : (
                  <p className="text-xs text-text-secondary">
                    {publicKey
                      ? `Connected: ${publicKey} — click Sign & Link Wallet.`
                      : "Connect Phantom or Solflare to verify wallet ownership."}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
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
                    Sign & Link Wallet
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

            {/* Candidate Profile PDA State */}
            <div className="rounded-lg border border-border bg-surface-elevated p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-text">
                    CandidateProfile PDA
                  </h3>
                  {data?.profilePdaAddress && (
                    <p className="text-[11px] font-mono text-text-muted break-all mt-0.5">
                      {data.profilePdaAddress}
                    </p>
                  )}
                </div>
                {data?.explorerProfileUrl && (
                  <a
                    href={data.explorerProfileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold text-purple-400 hover:underline shrink-0"
                  >
                    View on Explorer →
                  </a>
                )}
              </div>

              {data?.onChainProfile ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-lg bg-surface border border-border">
                      <span className="text-[11px] text-text-muted uppercase font-mono">
                        Highest Score
                      </span>
                      <p className="text-2xl font-extrabold text-purple-400 mt-1">
                        {data.onChainProfile.highestScore}/100
                      </p>
                    </div>
                    <div className="p-3.5 rounded-lg bg-surface border border-border">
                      <span className="text-[11px] text-text-muted uppercase font-mono">
                        Anchored Audits
                      </span>
                      <p className="text-2xl font-extrabold text-text mt-1">
                        {data.onChainProfile.evalCount}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-lg bg-surface border border-border">
                      <span className="text-[11px] text-text-muted uppercase font-mono">
                        Latest Role
                      </span>
                      <p className="text-sm font-bold text-text mt-2 truncate">
                        {data.onChainProfile.lastRoleTitle || "—"}
                      </p>
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] font-mono uppercase text-text-muted block mb-2">
                      Verified Skills ({data.onChainProfile.topSkills.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {data.onChainProfile.topSkills.map((skill) => (
                        <span
                          key={skill}
                          className="px-2 py-0.5 text-[11px] font-mono rounded-md bg-surface border border-border text-text-secondary"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-surface border border-border text-xs text-text-secondary flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <span>
                    No CandidateProfile PDA exists yet. Open any completed report’s On-Chain & SBT section to anchor it.
                  </span>
                  <Link href="/evaluations">
                    <Button variant="outline" size="sm" className="shrink-0">
                      Go to History →
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Token-2022 Non-Transferable Soulbound Credentials */}
      <div className="rounded-xl border border-border bg-surface p-6 sm:p-8 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-4">
          <div>
            <h2 className="text-xl font-extrabold text-text">
              Soulbound Credentials (Token-2022 SBT)
            </h2>
            <p className="text-xs text-text-secondary mt-1">
              Permanent non-transferable credentials minted for evaluations scoring 85/100 or higher.
            </p>
          </div>
          <span className="px-2.5 py-0.5 text-xs font-mono rounded-md bg-surface-elevated border border-border text-purple-400">
            {data?.credentials.length || 0} Minted
          </span>
        </div>

        {loading ? (
          <div className="py-6 flex justify-center">
            <LoadingSpinner label="Scanning Token-2022 Non-Transferable mints..." />
          </div>
        ) : !data?.credentials || data.credentials.length === 0 ? (
          <div className="p-6 rounded-lg bg-surface-elevated border border-border text-center space-y-2">
            <p className="text-sm font-bold text-text">No Soulbound Credentials Yet</p>
            <p className="text-xs text-text-secondary max-w-lg mx-auto">
              Score 85/100+ on any COOV evaluation, open its On-Chain & SBT menu, anchor the proof, and mint your SBT credential.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.credentials.map((cred) => (
              <div
                key={cred.mint}
                className="p-5 rounded-lg border border-border bg-surface-elevated space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface border border-border text-purple-400">
                        {cred.symbol || "COOV-SBT"}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface border border-border text-text-muted">
                        Soulbound
                      </span>
                    </div>
                    <h4 className="text-base font-extrabold text-text mt-2">
                      {cred.roleTitle || cred.name}
                    </h4>
                  </div>
                  {cred.scoreTier && (
                    <span className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface border border-border text-text">
                      {cred.scoreTier}
                    </span>
                  )}
                </div>

                <div className="space-y-1 text-[11px] font-mono text-text-muted">
                  <p className="truncate">Mint: {cred.mint}</p>
                  {cred.reportHash && (
                    <p className="truncate">SHA-256: {cred.reportHash}</p>
                  )}
                </div>

                <div className="pt-2 border-t border-border/70 flex items-center justify-between">
                  <a
                    href={cred.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold text-purple-400 hover:underline"
                  >
                    Inspect Mint →
                  </a>
                  {cred.evalId && (
                    <Link
                      href={`/evaluations/${cred.evalId}/report`}
                      className="text-xs font-semibold text-text-secondary hover:text-text"
                    >
                      Report →
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

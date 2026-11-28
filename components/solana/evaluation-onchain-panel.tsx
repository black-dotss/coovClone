"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { apiFetch } from "@/lib/client/api";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";

interface EvaluationSolanaStatus {
  evaluationId: string;
  jobDescriptionId: string;
  bountyContext?: {
    bountyId: string;
    title: string;
    company: string;
    minScore: number;
    isEligible: boolean;
  } | null;
  status: string;
  overallScore: number;
  scoreTier: string;
  sbtEligible: boolean;
  verdict: string | null;
  roleTitle: string;
  modelVersion: string;
  defenseRevisionsCount: number;
  canonicalReportHash: string | null;
  agentScores: {
    hr_recruiter: number;
    technical_interviewer: number;
    ats_scanner: number;
    hiring_manager: number;
    career_strategist: number;
    red_flag_analyst: number;
  };
  verifiedSkills: string[];
  linkedWallet: string | null;
  candidateWallet: string | null;
  profilePdaAddress: string | null;
  evalPdaAddress: string | null;
  evalTxSignature: string | null;
  evalTxUrl: string | null;
  evalPdaUrl: string | null;
  sbtMintAddress: string | null;
  sbtTxSignature: string | null;
  sbtTxUrl: string | null;
  sbtMintUrl: string | null;
  programConfigInitialized: boolean;
  needsDefenseSync: boolean;
  onChainEval: {
    candidate: string;
    compositeScore: number;
    currentReportHash: string;
    defenseCount: number;
    sbtMinted: boolean;
    sbtMint: string;
  } | null;
  rpcError: string | null;
}

export const EvaluationOnChainPanel: React.FC<{
  evaluationId: string;
  compact?: boolean;
}> = ({ evaluationId, compact = false }) => {
  const { publicKey, openConnectModal, signAndSubmitTx, clusterLabel } =
    useSolanaWallet();

  const [state, setState] = useState<EvaluationSolanaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [anchoring, setAnchoring] = useState(false);
  const [minting, setMinting] = useState(false);
  const [initializingConfig, setInitializingConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchStatus = useCallback(async (): Promise<EvaluationSolanaStatus> => {
    const q = publicKey ? `?wallet=${encodeURIComponent(publicKey)}` : "";
    return apiFetch<EvaluationSolanaStatus>(`/api/solana/evaluations/${evaluationId}${q}`);
  }, [evaluationId, publicKey]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchStatus();
      setState(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load on-chain evaluation status."
      );
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchStatus();
        if (active) setState(res);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load on-chain evaluation status."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchStatus]);

  const handleInitConfigWithWallet = async () => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setInitializingConfig(true);
    setError(null);
    setNotice(null);
    try {
      const prep = await apiFetch<{
        alreadyInitialized: boolean;
        serializedTxBase64: string | null;
      }>("/api/solana/admin/init-config", {
        method: "POST",
        body: JSON.stringify({ adminWallet: publicKey }),
      });

      if (!prep.alreadyInitialized && prep.serializedTxBase64) {
        const sig = await signAndSubmitTx(prep.serializedTxBase64);
        await apiFetch("/api/solana/admin/init-config", {
          method: "PATCH",
          body: JSON.stringify({ txSignature: sig }),
        });
        setNotice("COOV ProgramConfig initialized on Solana Devnet.");
      }
      await loadStatus();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Only authorized admins can initialize ProgramConfig."
      );
    } finally {
      setInitializingConfig(false);
    }
  };

  const handleAnchor = async () => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setAnchoring(true);
    setError(null);
    setNotice(null);
    try {
      const prepared = await apiFetch<{
        mode: "anchor" | "defense_sync";
        serializedTxBase64: string;
        evalPda: string;
      }>(`/api/solana/evaluations/${evaluationId}`, {
        method: "POST",
        body: JSON.stringify({ walletAddress: publicKey, action: "auto" }),
      });

      const txSignature = await signAndSubmitTx(prepared.serializedTxBase64);

      await apiFetch(`/api/solana/evaluations/${evaluationId}`, {
        method: "PATCH",
        body: JSON.stringify({
          walletAddress: publicKey,
          txSignature,
        }),
      });

      setNotice(
        prepared.mode === "defense_sync"
          ? "Updated EvaluationRecord PDA with your Defense reassessment."
          : "Anchored evaluation proof & CandidateProfile PDA on Solana Devnet."
      );
      await loadStatus();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to anchor evaluation on Solana."
      );
    } finally {
      setAnchoring(false);
    }
  };

  const handleMintSbt = async () => {
    if (!publicKey) {
      openConnectModal();
      return;
    }
    setMinting(true);
    setError(null);
    setNotice(null);
    try {
      const prepared = await apiFetch<{
        serializedTxBase64: string;
        sbtMintAddress: string;
      }>(`/api/solana/evaluations/${evaluationId}/mint-sbt`, {
        method: "POST",
        body: JSON.stringify({ walletAddress: publicKey }),
      });

      const txSignature = await signAndSubmitTx(prepared.serializedTxBase64);

      await apiFetch(`/api/solana/evaluations/${evaluationId}/mint-sbt`, {
        method: "PATCH",
        body: JSON.stringify({
          walletAddress: publicKey,
          txSignature,
          sbtMintAddress: prepared.sbtMintAddress,
        }),
      });

      setNotice("Minted Token-2022 Non-Transferable Soulbound Credential to your wallet.");
      await loadStatus();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to mint Soulbound Credential on Solana."
      );
    } finally {
      setMinting(false);
    }
  };

  if (loading && !state) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 flex items-center justify-center">
        <LoadingSpinner size="sm" label="Checking Solana on-chain proof..." />
      </div>
    );
  }

  if (!state) return null;

  const isAnchored = Boolean(state.onChainEval || state.evalTxSignature);
  const isSbtMinted = Boolean(state.sbtMintAddress || state.onChainEval?.sbtMinted);

  return (
    <div className="rounded-xl border border-border bg-surface p-6 sm:p-8 space-y-6">
      {state.bountyContext && (
        <div className="p-3.5 rounded-lg bg-surface-elevated border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div>
            <span className="font-bold text-text">
              Bounty: {state.bountyContext.title} ({state.bountyContext.company})
            </span>{" "}
            <span className={state.bountyContext.isEligible ? "text-purple-400 font-semibold" : "text-red-400 font-semibold"}>
              {state.bountyContext.isEligible
                ? `· Eligible (${state.overallScore}/${state.bountyContext.minScore} min)`
                : `· Not Eligible (Scored ${state.overallScore}/100 vs ${state.bountyContext.minScore} min)`}
            </span>
          </div>
          <Link
            href={`/bounties?fromEval=${encodeURIComponent(state.evaluationId)}&bountyId=${encodeURIComponent(state.bountyContext.bountyId)}`}
            className="text-purple-400 hover:underline font-semibold shrink-0"
          >
            Go to Bounty →
          </Link>
        </div>
      )}

      {/* Header + Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base sm:text-lg font-extrabold text-text">
              On-Chain Proof & Soulbound Credential
            </h3>
            <span className="px-2 py-0.5 text-[11px] font-mono rounded-md bg-surface-elevated border border-border text-purple-400">
              {isAnchored
                ? state.needsDefenseSync
                  ? "Defense Sync Ready"
                  : `Anchored · ${clusterLabel}`
                : `Unanchored · ${clusterLabel}`}
            </span>
            {isSbtMinted && (
              <span className="px-2 py-0.5 text-[11px] font-mono rounded-md bg-surface-elevated border border-border text-text">
                SBT Minted
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary">
            {state.sbtEligible
              ? "SHA-256 report attestation & non-transferable Token-2022 Soulbound Credential (>= 85/100)."
              : "SHA-256 report attestation on Solana. Score 85/100+ to unlock Token-2022 SBT minting."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!publicKey ? (
            <Button variant="primary" size="sm" onClick={openConnectModal}>
              Connect Wallet
            </Button>
          ) : !isAnchored ? (
            <Button
              variant="primary"
              size="sm"
              isLoading={anchoring}
              disabled={!state.programConfigInitialized || state.status !== "completed"}
              onClick={() => void handleAnchor()}
            >
              Anchor Evaluation On-Chain
            </Button>
          ) : state.needsDefenseSync ? (
            <Button
              variant="primary"
              size="sm"
              isLoading={anchoring}
              onClick={() => void handleAnchor()}
            >
              Sync Defense Score On-Chain
            </Button>
          ) : null}

          {isAnchored && state.sbtEligible && !isSbtMinted && (
            <Button
              variant="outline"
              size="sm"
              isLoading={minting}
              onClick={() => void handleMintSbt()}
            >
              Mint Soulbound SBT
            </Button>
          )}
        </div>
      </div>

      {!state.programConfigInitialized && (
        <Alert
          variant="warning"
          title="Protocol Config Not Initialized on Devnet"
          action={
            <Button
              variant="outline"
              size="sm"
              isLoading={initializingConfig}
              onClick={() => void handleInitConfigWithWallet()}
            >
              Initialize Config
            </Button>
          }
        >
          Click Initialize Config with an authorized admin wallet to activate on-chain attestations.
        </Alert>
      )}

      {error && <Alert variant="danger">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      {state.rpcError && (
        <Alert variant="warning" title="RPC Warning">
          {state.rpcError}
        </Alert>
      )}

      {!compact && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-surface-elevated border border-border space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2.5">
              <span className="text-xs font-mono uppercase tracking-wider text-text-muted">
                Verified Score
              </span>
              <span className="text-xl font-extrabold text-purple-400">
                {state.overallScore}/100
                <span className="ml-2 text-xs font-mono font-semibold text-text-secondary">
                  {state.scoreTier}
                </span>
              </span>
            </div>

            <div className="space-y-1.5 text-xs font-mono">
              {state.evalPdaAddress && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted shrink-0">Eval PDA</span>
                  <a
                    href={state.evalPdaUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple-400 hover:underline truncate"
                  >
                    {state.evalPdaAddress}
                  </a>
                </div>
              )}
              {state.evalTxUrl && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted shrink-0">Anchor Tx</span>
                  <a
                    href={state.evalTxUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple-400 hover:underline truncate"
                  >
                    {state.evalTxSignature}
                  </a>
                </div>
              )}
              {state.sbtMintUrl && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted shrink-0">SBT Mint</span>
                  <a
                    href={state.sbtMintUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple-400 hover:underline truncate"
                  >
                    {state.sbtMintAddress}
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="p-4 rounded-lg bg-surface-elevated border border-border space-y-3">
            <div className="flex items-center justify-between text-[11px] font-mono text-text-muted border-b border-border pb-2">
              <span>Canonical Report SHA-256</span>
              <span>{state.modelVersion}</span>
            </div>
            <p className="font-mono text-xs text-text break-all leading-relaxed">
              {state.canonicalReportHash || "Pending completion"}
            </p>
            {state.verifiedSkills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {state.verifiedSkills.map((skill) => (
                  <span
                    key={skill}
                    className="px-2 py-0.5 text-[11px] font-mono rounded-md bg-surface border border-border text-text-secondary"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

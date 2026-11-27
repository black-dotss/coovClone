"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { apiFetch } from "@/lib/client/api";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";

interface EvaluationSolanaStatus {
  evaluationId: string;
  jobDescriptionId: string;
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
        setNotice("COOV ProgramConfig PDA initialized on Solana Devnet!");
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
          ? "Updated on-chain EvaluationRecord PDA with your Defense reassessment!"
          : "Anchored evaluation proof & CandidateProfile PDA on Solana Devnet!"
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

      setNotice("Minted Token-2022 Non-Transferable Soulbound Credential to your wallet!");
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
      <div className="rounded-xl border border-border bg-surface p-5 flex items-center justify-center">
        <LoadingSpinner size="sm" label="Checking Solana on-chain proof..." />
      </div>
    );
  }

  if (!state) return null;

  const isAnchored = Boolean(state.onChainEval || state.evalTxSignature);
  const isSbtMinted = Boolean(state.sbtMintAddress || state.onChainEval?.sbtMinted);
  const effectiveScore = state.overallScore;

  return (
    <div className="rounded-2xl border border-purple-500/30 bg-surface p-5 sm:p-6 space-y-4 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm sm:text-base font-bold text-text">
              Solana On-Chain Proof & Soulbound Credential
            </h3>
            <Badge variant={isAnchored ? "success" : "purple"} size="sm">
              {isAnchored
                ? state.needsDefenseSync
                  ? "Defense Update Ready"
                  : `Anchored · Solana ${clusterLabel}`
                : `Not Yet Anchored · ${clusterLabel}`}
            </Badge>
            {isSbtMinted && (
              <Badge variant="warning" size="sm">
                Token-2022 SBT Minted
              </Badge>
            )}
          </div>
          <p className="text-xs text-text-secondary">
            Anchor the SHA-256 hash of all 6 committee scores onto Solana Devnet
            {state.sbtEligible
              ? " and mint your non-transferable Soulbound Token (>= 85/100)."
              : ". Score >= 85/100 (directly or via Defend Yourself) unlocks Soulbound SBT minting."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!publicKey ? (
            <Button variant="primary" size="sm" onClick={openConnectModal}>
              Connect Solana Wallet
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
              variant="secondary"
              size="sm"
              isLoading={minting}
              onClick={() => void handleMintSbt()}
            >
              Mint Soulbound Credential
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
              Initialize Config (Admin)
            </Button>
          }
        >
          Run <code>npx tsx scripts/init-solana-config.ts</code> or click Initialize Config with an admin wallet to activate on-chain attestations.
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="p-3.5 rounded-xl bg-surface-elevated/60 border border-border space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-text-muted">
              <span>Canonical Report SHA-256</span>
              <span>Model: {state.modelVersion}</span>
            </div>
            <p className="font-mono text-xs text-text break-all">
              {state.canonicalReportHash || "Pending completion"}
            </p>
            <div className="flex flex-wrap gap-1 pt-1">
              {state.verifiedSkills.map((s) => (
                <Badge key={s} variant="neutral" size="sm">
                  {s}
                </Badge>
              ))}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-elevated/60 border border-border space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-text-muted font-mono">On-Chain Status</span>
              <span className="font-semibold text-text">
                {effectiveScore}/100 ({state.scoreTier})
              </span>
            </div>
            {state.evalPdaAddress && (
              <p className="font-mono text-[11px] text-text-secondary truncate">
                Eval PDA:{" "}
                <a
                  href={state.evalPdaUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-purple-400 hover:underline"
                >
                  {state.evalPdaAddress}
                </a>
              </p>
            )}
            {state.evalTxUrl && (
              <p className="font-mono text-[11px] text-text-secondary truncate">
                Anchor Tx:{" "}
                <a
                  href={state.evalTxUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 hover:underline"
                >
                  {state.evalTxSignature}
                </a>
              </p>
            )}
            {state.sbtMintUrl && (
              <p className="font-mono text-[11px] text-text-secondary truncate">
                SBT Mint:{" "}
                <a
                  href={state.sbtMintUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-400 hover:underline"
                >
                  {state.sbtMintAddress}
                </a>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

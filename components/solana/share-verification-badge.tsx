"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SharedOnChainProofMetadata } from "@/lib/reports/share";
import type { StructuredEvaluationReport } from "@/lib/reports/types";
import {
  buildCanonicalReportPayload,
  computeCanonicalReportHash,
} from "@/lib/solana/canonical-hash";

interface VerifyApiResult {
  exists: boolean;
  cluster: string;
  evalPda: string;
  evalPdaUrl: string;
  record: {
    candidate: string;
    initialReportHash: string;
    currentReportHash: string;
    initialScore: number;
    compositeScore: number;
    agentScores: {
      hr_recruiter: number;
      technical_interviewer: number;
      ats_scanner: number;
      hiring_manager: number;
      career_strategist: number;
      red_flag_analyst: number;
    };
    defenseCount: number;
    sbtMinted: boolean;
    sbtMint: string;
    modelVersion: string;
    roleTitle: string;
    createdAt: number;
    updatedAt: number;
  } | null;
}

export const ShareVerificationBadge: React.FC<{
  report: StructuredEvaluationReport;
  proof: SharedOnChainProofMetadata;
}> = ({ report, proof }) => {
  const [browserHash, setBrowserHash] = useState<string | null>(null);
  const [onChain, setOnChain] = useState<VerifyApiResult | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;

    async function verifyInBrowser() {
      try {
        const payload = buildCanonicalReportPayload({
          evaluationId: proof.evaluationId,
          jobDescriptionId: proof.jobDescriptionId,
          overallScore: proof.overallScore,
          verdict: proof.verdict,
          confidence: report.confidence ?? 0.85,
          dimensions: report.dimensions,
          explanation: report.explanation,
          strengths: report.strengths,
          weaknesses: report.weaknesses,
          prioritizedFixes: report.prioritizedFixes,
          redFlags: report.redFlags.map((rf) => ({
            ...rf,
            isProofOfProblem: false as const,
          })),
          atsSummary: report.atsSummary,
          agentScores: proof.agentScores,
          modelVersion: proof.modelVersion,
          defenseRevisionsCount: proof.defenseRevisionsCount,
        });

        const { hashHex } = await computeCanonicalReportHash(payload);
        if (!active) return;
        setBrowserHash(hashHex);

        if (proof.candidateWallet) {
          const res = await fetch(
            `/api/solana/verify?wallet=${encodeURIComponent(proof.candidateWallet)}&evalId=${encodeURIComponent(proof.evaluationId)}`
          );
          if (res.ok) {
            const json = (await res.json()) as { data?: VerifyApiResult };
            if (active && json?.data) {
              setOnChain(json.data);
            }
          }
        }
      } catch {
        // Non-fatal verification fallback
      } finally {
        if (active) setChecking(false);
      }
    }

    void verifyInBrowser();
    return () => {
      active = false;
    };
  }, [proof, report]);

  const chainHash = onChain?.record?.currentReportHash || null;
  const isVerifiedMatch = Boolean(
    browserHash && chainHash && browserHash.toLowerCase() === chainHash.toLowerCase()
  );
  const isAnchoredOutOfSync = Boolean(onChain?.exists && !isVerifiedMatch);

  const cluster = onChain?.cluster || "devnet";
  const clusterQuery = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;

  return (
    <Card className="bg-surface border-border rounded-xl">
      <CardHeader className="border-b border-border pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-xs font-extrabold uppercase tracking-wider text-text font-mono">
              Cryptographic Audit & Solana On-Chain Proof
            </CardTitle>
            <span className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface-elevated border border-border text-purple-400">
              {checking
                ? "Verifying SHA-256..."
                : isVerifiedMatch
                ? "Verified On-Chain"
                : isAnchoredOutOfSync
                ? "Anchored (Resync Needed)"
                : "Off-Chain Only"}
            </span>
          </div>

          {(proof.sbtMintAddress || onChain?.record?.sbtMinted) && (
            <a
              href={`https://explorer.solana.com/address/${
                onChain?.record?.sbtMint || proof.sbtMintAddress
              }${clusterQuery}`}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface-elevated border border-border text-purple-400 hover:underline"
            >
              Soulbound SBT Verified →
            </a>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-surface-elevated border border-border space-y-1">
            <span className="text-[11px] font-mono text-text-muted">
              Browser SHA-256 Digest
            </span>
            <p className="font-mono text-[11px] text-text break-all">
              {browserHash || proof.canonicalReportHash}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-surface-elevated border border-border space-y-1">
            <span className="text-[11px] font-mono text-text-muted">
              On-Chain EvaluationRecord PDA Hash
            </span>
            <p className="font-mono text-[11px] text-text break-all">
              {chainHash || "Not anchored on Solana yet"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {[
            ["HR Recruiter", proof.agentScores.hr_recruiter],
            ["Tech Lead", proof.agentScores.technical_interviewer],
            ["ATS Scanner", proof.agentScores.ats_scanner],
            ["Hiring Mgr", proof.agentScores.hiring_manager],
            ["Career Strat.", proof.agentScores.career_strategist],
            ["Red Flags", proof.agentScores.red_flag_analyst],
          ].map(([label, score]) => (
            <div
              key={String(label)}
              className="p-2.5 rounded-lg bg-surface-elevated border border-border text-center"
            >
              <span className="text-[10px] font-mono text-text-muted block truncate">
                {label}
              </span>
              <span className="text-sm font-extrabold text-purple-400">
                {score}/100
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60 text-[11px] font-mono text-text-muted">
          <span>
            Model: {onChain?.record?.modelVersion || proof.modelVersion} · Defense Updates:{" "}
            {onChain?.record?.defenseCount ?? proof.defenseRevisionsCount}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            {onChain?.evalPda && (
              <a
                href={onChain.evalPdaUrl}
                target="_blank"
                rel="noreferrer"
                className="text-purple-400 hover:underline font-semibold"
              >
                Evaluation PDA →
              </a>
            )}
            {proof.evalTxSignature && (
              <a
                href={`https://explorer.solana.com/tx/${proof.evalTxSignature}${clusterQuery}`}
                target="_blank"
                rel="noreferrer"
                className="text-purple-400 hover:underline font-semibold"
              >
                Anchor Tx →
              </a>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

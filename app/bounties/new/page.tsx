"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { apiFetch } from "@/lib/client/api";
import { useSession } from "@/lib/auth/auth-client";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";

export default function NewBountyPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { publicKey, openConnectModal, signAndSubmitTx, clusterLabel } =
    useSolanaWallet();

  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [minScore, setMinScore] = useState("85");
  const [rewardPerWinner, setRewardPerWinner] = useState("20");
  const [maxWinners, setMaxWinners] = useState("5");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [rawText, setRawText] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalPoolUsdc = (Number(rewardPerWinner) || 0) * (Number(maxWinners) || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!session) {
      router.push("/auth?callbackUrl=/bounties/new");
      return;
    }
    if (!publicKey) {
      openConnectModal();
      return;
    }
    if (!title.trim() || !company.trim()) {
      setErrorMessage("Please enter both role title and company name.");
      return;
    }
    if (rawText.trim().length < 30) {
      setErrorMessage("Job description must be at least 30 characters.");
      return;
    }

    setSubmitting(true);
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

      router.push("/bounties?created=1");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to fund bounty escrow. Please retry.";
      setErrorMessage(msg);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header matching /evaluations/new */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link
              href="/bounties"
              className="text-xs font-mono text-text-muted hover:text-purple-400 transition-colors"
            >
              ← Back to Bounties
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-text">
            Post USDC Bounty Escrow
          </h1>
        </div>
        <Badge variant="purple" size="sm">
          Solana {clusterLabel} · USDC
        </Badge>
      </div>

      {/* Prominent Top Error Alert — never hidden behind a modal */}
      {errorMessage && (
        <Alert
          variant="danger"
          title="Escrow Transaction Failed"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setErrorMessage(null)}
            >
              Dismiss
            </Button>
          }
        >
          {errorMessage}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Pool Terms & Wallet Summary */}
          <div className="lg:col-span-5 space-y-6">
            <Card className="bg-surface border-border">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-base font-bold text-text">
                  1. Bounty Pool & Threshold
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Minimum Score (50–100)"
                    type="number"
                    min={50}
                    max={100}
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                    required
                  />
                  <Input
                    label="USDC Per Winner"
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
                    label="Expires In (Days)"
                    type="number"
                    min={1}
                    max={180}
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(e.target.value)}
                    required
                  />
                </div>

                <div className="p-4 rounded-xl bg-surface-elevated border border-purple-500/30 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-text-muted">Total Escrow Lock</span>
                    <span className="text-lg font-extrabold text-purple-400">
                      {totalPoolUsdc.toFixed(2)} USDC
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    First {maxWinners || 1} candidate(s) scoring{" "}
                    <span className="font-semibold text-text">
                      {minScore || 85}/100+
                    </span>{" "}
                    and anchoring their COOV report on-chain claim{" "}
                    <span className="font-semibold text-text">
                      {rewardPerWinner || 0} USDC
                    </span>{" "}
                    each. Unclaimed funds withdraw cleanly after expiry.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-surface border-border">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-base font-bold text-text">
                  2. Funding Wallet
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {publicKey ? (
                  <div className="p-3.5 rounded-xl bg-surface-elevated border border-border space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-text-muted uppercase">
                        Connected Wallet ({clusterLabel})
                      </span>
                      <Badge variant="purple" size="sm">
                        Ready
                      </Badge>
                    </div>
                    <p className="font-mono text-xs text-text break-all">
                      {publicKey}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-text-secondary">
                      Connect your Solana {clusterLabel} wallet containing USDC and SOL for fees.
                    </p>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      className="w-full font-semibold"
                      onClick={openConnectModal}
                    >
                      Connect Solana Wallet
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Target Role & Requirements */}
          <div className="lg:col-span-7">
            <Card className="bg-surface border-border h-full flex flex-col justify-between">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-base font-bold text-text">
                  3. Target Role & Requirements
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4 flex-1 flex flex-col">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Company / Organization *"
                    placeholder="e.g. Solana Labs"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    required
                  />
                  <Input
                    label="Role Title *"
                    placeholder="e.g. Senior Rust Engineer"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-text">
                    Full Job Description *
                  </label>
                  <Textarea
                    placeholder="Paste role responsibilities, technical stack, and evaluation expectations..."
                    rows={12}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    className="text-sm flex-1 min-h-[240px]"
                    required
                  />
                  <span className="text-[11px] font-mono text-text-muted text-right">
                    {rawText.trim().length} characters (min 30)
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Inline Error Mirror right beside Submit for long viewports */}
        {errorMessage && (
          <Alert variant="danger" title="Transaction Error">
            {errorMessage}
          </Alert>
        )}

        {/* Submit Button */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link href="/bounties">
            <Button type="button" variant="outline" size="lg">
              Cancel
            </Button>
          </Link>
          {!publicKey ? (
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="min-w-[220px] font-bold"
              onClick={openConnectModal}
            >
              Connect Wallet to Fund →
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={submitting}
              className="min-w-[240px] font-bold bg-purple-600 hover:bg-purple-500"
            >
              {submitting
                ? "Confirming Escrow..."
                : `Deposit ${totalPoolUsdc.toFixed(2)} USDC & Post →`}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

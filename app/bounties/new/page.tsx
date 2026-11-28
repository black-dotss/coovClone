"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorPopup } from "@/components/ui/error-popup";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { apiFetch } from "@/lib/client/api";
import { useSession } from "@/lib/auth/auth-client";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";
import { BountyCompanyLogo } from "@/components/solana/bounty-company-logo";

async function resizeLogoFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please select a PNG, JPEG, or WebP image for the company logo.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Logo image file must be under 5 MB.");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read logo image file."));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("Invalid image file format."));
      img.onload = () => {
        const maxDim = 160;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || maxDim) * scale));
        const height = Math.max(1, Math.round((img.height || maxDim) * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Browser canvas unavailable to process logo image."));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/webp", 0.85);
        resolve(dataUrl);
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

export default function NewBountyPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { publicKey, openConnectModal, signAndSubmitTx, clusterLabel } =
    useSolanaWallet();

  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [minScore, setMinScore] = useState("85");
  const [rewardPerWinner, setRewardPerWinner] = useState("20");
  const [stakePct, setStakePct] = useState("10");
  const [maxWinners, setMaxWinners] = useState("5");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [rawText, setRawText] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalPoolUsdc = (Number(rewardPerWinner) || 0) * (Number(maxWinners) || 0);
  const normalizedStakePct = Math.min(100, Math.max(1, Number(stakePct) || 10));
  const stakePerCandidateUsdc =
    ((Number(rewardPerWinner) || 0) * normalizedStakePct) / 100;

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setLogoError(null);
    if (!file) return;
    try {
      const dataUrl = await resizeLogoFileToDataUrl(file);
      setCompanyLogoUrl(dataUrl);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Failed to load logo image.");
    }
  };

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
      setErrorMessage("Please enter both company name and role title.");
      return;
    }
    if (rawText.trim().length < 50) {
      setErrorMessage("Job description must be at least 50 characters long.");
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
          companyLogoUrl,
          rawText: rawText.trim(),
          recruiterWallet: publicKey,
          minScore: Number(minScore),
          rewardPerWinnerUsdc: Number(rewardPerWinner),
          stakePct: normalizedStakePct,
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
          companyLogoUrl,
          txSignature,
        }),
      });

      setRedirecting(true);
      router.push("/bounties?created=1");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to fund bounty escrow. Please retry.";
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (isPending || redirecting) {
    return <FullPageLoading />;
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <ErrorPopup
        title={logoError && !errorMessage ? "Logo Upload Notice" : "Transaction Error"}
        message={errorMessage || logoError}
        onDismiss={() => {
          setErrorMessage(null);
          setLogoError(null);
        }}
      />

      {/* Header matching /evaluations/new */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div className="space-y-1">
          <Link
            href="/bounties"
            className="text-xs font-mono text-text-muted hover:text-purple-400 transition-colors"
          >
            ← Back to Bounties
          </Link>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text">
            Post USDC Bounty Escrow
          </h1>
        </div>
        <span className="px-2.5 py-1 text-xs font-mono rounded-md bg-surface-elevated border border-border text-purple-400">
          Solana {clusterLabel} · USDC
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Pool Terms & Wallet Summary */}
          <div className="lg:col-span-5 space-y-6">
            <Card className="bg-surface border-border rounded-xl">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-base font-bold text-text">
                  1. Bounty Pool & Threshold
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-4">
                <div className="grid grid-cols-2 gap-3.5">
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
                    label="Required Stake (%)"
                    type="number"
                    step="0.5"
                    min={1}
                    max={100}
                    value={stakePct}
                    onChange={(e) => setStakePct(e.target.value)}
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
                  <div className="col-span-2">
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
                </div>

                <div className="p-4 rounded-lg bg-surface-elevated border border-border space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-text-muted">Total Escrow Lock</span>
                    <span className="text-lg font-extrabold text-purple-400">
                      {totalPoolUsdc.toFixed(2)} USDC
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-border/60">
                    <span className="text-text-muted">Candidate Conviction Stake ({normalizedStakePct}%)</span>
                    <span className="font-bold text-text">
                      {stakePerCandidateUsdc.toFixed(2)} USDC / applicant
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    Applicants lock{" "}
                    <span className="font-semibold text-text">
                      {stakePerCandidateUsdc.toFixed(2)} USDC
                    </span>{" "}
                    before entering review. Legitimate winners scoring{" "}
                    <span className="font-semibold text-text">
                      {minScore || 85}/100+
                    </span>{" "}
                    receive{" "}
                    <span className="font-semibold text-text">
                      {rewardPerWinner || 0} USDC
                    </span>{" "}
                    + 100% stake refund + pro-rata slashed fraud stakes.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-surface border-border rounded-xl">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-base font-bold text-text">
                  2. Funding Wallet
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-3">
                {publicKey ? (
                  <div className="p-4 rounded-lg bg-surface-elevated border border-border space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-text-muted uppercase">
                        Connected Wallet ({clusterLabel})
                      </span>
                      <span className="text-[11px] font-mono text-purple-400 font-semibold">
                        Ready
                      </span>
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
                      size="md"
                      className="w-full"
                      onClick={openConnectModal}
                    >
                      Connect Solana Wallet
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Target Role, Company Logo & Requirements */}
          <div className="lg:col-span-7">
            <Card className="bg-surface border-border rounded-xl h-full flex flex-col justify-between">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-base font-bold text-text">
                  3. Target Role & Company Details
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-5 flex-1 flex flex-col">
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

                {/* Optional Company Logo Upload */}
                <div className="p-4 rounded-lg bg-surface-elevated border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <BountyCompanyLogo
                      company={company || "CO"}
                      logoUrl={companyLogoUrl}
                      size="lg"
                    />
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs font-bold text-text">
                        Company Logo (Optional)
                      </p>
                      <p className="text-[11px] text-text-secondary">
                        Upload PNG, JPEG, or WebP to display on your bounty listing.
                      </p>
                      {logoError && (
                        <p className="text-[11px] text-purple-400 font-semibold">
                          {logoError}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:border-purple-500/50 text-xs font-semibold text-text cursor-pointer transition-colors">
                      {companyLogoUrl ? "Change Logo" : "Upload Logo"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => void handleLogoChange(e)}
                        className="sr-only"
                      />
                    </label>
                    {companyLogoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCompanyLogoUrl(null)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
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
                    {rawText.trim().length} characters (min 50)
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

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
              className="min-w-[220px]"
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
              className="min-w-[240px]"
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

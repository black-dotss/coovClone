"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { ProfileOnChainPanel } from "@/components/solana/profile-onchain-panel";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";
import { useSession } from "@/lib/auth/auth-client";

export default function OnChainPage() {
  const { data: session, isPending } = useSession();
  const { clusterLabel, openConnectModal, publicKey } = useSolanaWallet();

  if (isPending) {
    return <FullPageLoading />;
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-text">
              On-Chain &amp; SBT
            </h1>
            <span className="px-3 py-1 text-xs font-mono font-bold rounded-lg bg-surface-elevated border border-border text-purple-400">
              Solana {clusterLabel}
            </span>
          </div>
          <p className="text-sm sm:text-base text-text-secondary">
            Your permanent on-chain candidate scorecard, verified reputation streak, and Soulbound Token-2022 credentials.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <Link href="/bounties">
            <Button variant="outline" size="md">
              Browse Bounties
            </Button>
          </Link>
          <Link href="/evaluations/new">
            <Button variant="primary" size="md">
              + New Review
            </Button>
          </Link>
        </div>
      </div>

      {!session ? (
        <div className="rounded-2xl border border-border bg-surface p-8 sm:p-12 text-center space-y-5 max-w-2xl mx-auto">
          <h2 className="text-2xl font-black text-text">
            Sign in to View Your On-Chain Scorecard &amp; SBTs
          </h2>
          <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
            Link your Solana wallet to view anchored evaluation proofs, track your 30-day verified streak, and inspect minted Soulbound credentials.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link href="/auth?callbackUrl=/on-chain">
              <Button variant="primary" size="lg">
                Sign In to Continue →
              </Button>
            </Link>
            {!publicKey && (
              <Button variant="outline" size="lg" onClick={openConnectModal}>
                Connect Solana Wallet
              </Button>
            )}
          </div>
        </div>
      ) : (
        <ProfileOnChainPanel />
      )}
    </div>
  );
}

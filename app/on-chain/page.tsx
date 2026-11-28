"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { ProfileOnChainPanel } from "@/components/solana/profile-onchain-panel";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";
import { useSession } from "@/lib/auth/auth-client";

export default function OnChainPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { clusterLabel } = useSolanaWallet();

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/auth?callbackUrl=/on-chain");
    }
  }, [isPending, session, router]);

  if (isPending || !session) {
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

      <ProfileOnChainPanel />
    </div>
  );
}

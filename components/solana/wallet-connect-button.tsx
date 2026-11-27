"use client";

import React from "react";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";

function shortenAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export const WalletConnectButton: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => {
  const { publicKey, selectedWallet, clusterLabel, openConnectModal } =
    useSolanaWallet();

  if (publicKey) {
    return (
      <button
        type="button"
        onClick={openConnectModal}
        title={`Connected with ${selectedWallet?.name || "Wallet"} (${publicKey})`}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:border-purple-500/50 bg-surface-elevated text-text text-xs font-semibold transition-colors cursor-pointer shrink-0"
      >
        <span className="w-1.5 h-1.5 rounded-xs bg-purple-400 shrink-0" />
        <span className="font-mono">{shortenAddress(publicKey)}</span>
        {!compact && (
          <span className="hidden xl:inline text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface border border-border text-purple-400">
            {clusterLabel}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openConnectModal}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:border-purple-500/50 bg-surface-elevated text-text text-xs font-semibold transition-colors cursor-pointer shrink-0"
    >
      <svg
        className="w-3.5 h-3.5 text-purple-400 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-2m2-4h-6a2 2 0 100 4h6v-4z"
        />
      </svg>
      <span>{compact ? "Wallet" : "Connect Wallet"}</span>
    </button>
  );
};

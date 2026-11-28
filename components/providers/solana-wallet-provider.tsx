"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  type StandardConnectFeature,
} from "@wallet-standard/features";
import {
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorPopup } from "@/components/ui/error-popup";
import { apiFetch } from "@/lib/client/api";

const STORAGE_KEY = "coov_preferred_solana_wallet";

function getTargetChain(): `solana:${string}` {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet";
  if (cluster === "mainnet-beta") return "solana:mainnet";
  if (cluster === "testnet") return "solana:testnet";
  return "solana:devnet";
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let output = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    output += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]];
  }
  return output;
}

function base64ToUint8(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function isSolanaCompatibleWallet(wallet: Wallet): boolean {
  const hasSolanaChain = wallet.chains.some((c) => c.startsWith("solana:"));
  const hasConnect = StandardConnect in wallet.features;
  const hasSign =
    SolanaSignTransaction in wallet.features ||
    SolanaSignAndSendTransaction in wallet.features;
  return hasSolanaChain && hasConnect && hasSign;
}

export interface SolanaWalletContextValue {
  wallets: readonly Wallet[];
  selectedWallet: Wallet | null;
  account: WalletAccount | null;
  publicKey: string | null;
  connecting: boolean;
  walletError: string | null;
  clusterLabel: string;
  openConnectModal: () => void;
  closeConnectModal: () => void;
  connectWallet: (wallet: Wallet, silent?: boolean) => Promise<WalletAccount | null>;
  disconnectWallet: () => Promise<void>;
  signMessageText: (message: string) => Promise<{ signatureBase64: string; signedMessageBase64: string }>;
  signAndSubmitTx: (serializedTxBase64: string) => Promise<string>;
}

const SolanaWalletContext = createContext<SolanaWalletContextValue | null>(null);

function formatClientWalletError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "Wallet transaction failed.");
  if (/user rejected|rejected the request/i.test(raw)) {
    return "Transaction cancelled in wallet.";
  }
  if (/custom program error:\s*0x1\b|"Custom":1\b|insufficient funds|insufficient lamports/i.test(raw)) {
    return "Insufficient Devnet USDC or SOL balance in your wallet to complete this transaction.";
  }
  if (/Blockhash not found/i.test(raw)) {
    return "Solana transaction blockhash expired. Please click Submit again to sign with a fresh blockhash.";
  }
  if (/^failed to fetch$|^fetch failed$/i.test(raw.trim())) {
    return "Network error while contacting Solana RPC. Please retry in a few seconds.";
  }
  return raw.replace(/\s*Catch the `SendTransactionError`[\s\S]*$/i, "").trim();
}

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const autoConnectAttempted = useRef(false);

  const refreshWallets = useCallback(() => {
    try {
      const registered = getWallets().get().filter(isSolanaCompatibleWallet);
      setWallets(registered);
      return registered;
    } catch {
      return [];
    }
  }, []);

  const connectWallet = useCallback(
    async (wallet: Wallet, silent = false): Promise<WalletAccount | null> => {
      setConnecting(true);
      setWalletError(null);
      try {
        const connectFeature = wallet.features[StandardConnect] as
          | StandardConnectFeature[typeof StandardConnect]
          | undefined;
        if (!connectFeature) {
          throw new Error(`${wallet.name} does not support Wallet Standard connect.`);
        }

        const result = await connectFeature.connect(silent ? { silent: true } : undefined);
        const solanaAcc =
          result.accounts.find((acc) => acc.chains.some((c) => c.startsWith("solana:"))) ??
          result.accounts[0] ??
          null;

        if (!solanaAcc) {
          if (!silent) {
            throw new Error(`No Solana account returned by ${wallet.name}.`);
          }
          return null;
        }

        setSelectedWallet(wallet);
        setAccount(solanaAcc);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY, wallet.name);
        }
        setIsModalOpen(false);
        return solanaAcc;
      } catch (err) {
        if (!silent) {
          setWalletError(
            err instanceof Error ? err.message : `Failed to connect to ${wallet.name}`
          );
        }
        return null;
      } finally {
        setConnecting(false);
      }
    },
    []
  );

  useEffect(() => {
    const api = getWallets();
    let mounted = true;

    Promise.resolve().then(() => {
      if (!mounted) return;
      const initial = refreshWallets();
      const preferred =
        typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (preferred && !autoConnectAttempted.current) {
        const found = initial.find((w) => w.name === preferred);
        if (found) {
          autoConnectAttempted.current = true;
          void connectWallet(found, true);
        }
      }
    });

    const offRegister = api.on("register", () => {
      const updated = refreshWallets();
      const pref =
        typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (pref && !autoConnectAttempted.current) {
        const match = updated.find((w) => w.name === pref);
        if (match) {
          autoConnectAttempted.current = true;
          void connectWallet(match, true);
        }
      }
    });

    const offUnregister = api.on("unregister", () => {
      refreshWallets();
    });

    return () => {
      mounted = false;
      offRegister();
      offUnregister();
    };
  }, [connectWallet, refreshWallets]);

  const disconnectWallet = useCallback(async () => {
    setWalletError(null);
    try {
      if (selectedWallet && "standard:disconnect" in selectedWallet.features) {
        const disc = selectedWallet.features["standard:disconnect"] as {
          disconnect: () => Promise<void>;
        };
        await disc.disconnect();
      }
    } catch {
      // Non-fatal on disconnect
    } finally {
      setSelectedWallet(null);
      setAccount(null);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [selectedWallet]);

  const signMessageText = useCallback(
    async (message: string) => {
      if (!selectedWallet || !account) {
        throw new Error("Connect a Solana wallet first.");
      }
      const feature = selectedWallet.features[SolanaSignMessage] as
        | SolanaSignMessageFeature[typeof SolanaSignMessage]
        | undefined;
      if (!feature) {
        throw new Error(`${selectedWallet.name} does not support message signing.`);
      }

      const encoded = new TextEncoder().encode(message);
      const outputs = await feature.signMessage({
        account,
        message: encoded,
      });
      const first = outputs[0];
      if (!first) {
        throw new Error("Wallet did not return a signature.");
      }

      return {
        signatureBase64: uint8ToBase64(first.signature),
        signedMessageBase64: uint8ToBase64(first.signedMessage),
      };
    },
    [account, selectedWallet]
  );

  const signAndSubmitTx = useCallback(
    async (serializedTxBase64: string): Promise<string> => {
      if (!selectedWallet || !account) {
        throw new Error("Connect your Solana wallet before signing.");
      }

      const txBytes = base64ToUint8(serializedTxBase64);
      const chain = getTargetChain();

      // Prefer signTransaction + server RPC broadcast so partially signed oracle txs
      // are always submitted via the configured cluster RPC without client rate-limits.
      const signTxFeature = selectedWallet.features[SolanaSignTransaction] as
        | SolanaSignTransactionFeature[typeof SolanaSignTransaction]
        | undefined;

      if (signTxFeature) {
        try {
          const outputs = await signTxFeature.signTransaction({
            account,
            transaction: txBytes,
            chain,
            options: {
              preflightCommitment: "confirmed",
            },
          });
          const signed = outputs[0]?.signedTransaction;
          if (!signed) {
            throw new Error("Wallet did not return a signed transaction.");
          }

          const broadcastRes = await apiFetch<{ signature: string }>(
            "/api/solana/broadcast",
            {
              method: "POST",
              body: JSON.stringify({
                signedTxBase64: uint8ToBase64(signed),
              }),
            }
          );
          return broadcastRes.signature;
        } catch (err) {
          throw new Error(formatClientWalletError(err));
        }
      }

      const signAndSendFeature = selectedWallet.features[
        SolanaSignAndSendTransaction
      ] as
        | SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction]
        | undefined;

      if (signAndSendFeature) {
        try {
          const outputs = await signAndSendFeature.signAndSendTransaction({
            account,
            transaction: txBytes,
            chain,
            options: {
              commitment: "confirmed",
              preflightCommitment: "confirmed",
            },
          });
          const rawSig = outputs[0]?.signature;
          if (!rawSig) {
            throw new Error("Wallet did not return a transaction signature.");
          }
          return encodeBase58(rawSig);
        } catch (err) {
          throw new Error(formatClientWalletError(err));
        }
      }

      throw new Error(`${selectedWallet.name} does not support Solana transaction signing.`);
    },
    [account, selectedWallet]
  );

  const value = useMemo<SolanaWalletContextValue>(
    () => ({
      wallets,
      selectedWallet,
      account,
      publicKey: account?.address ?? null,
      connecting,
      walletError,
      clusterLabel:
        (process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet") === "mainnet-beta"
          ? "Mainnet"
          : "Devnet",
      openConnectModal: () => {
        refreshWallets();
        setWalletError(null);
        setIsModalOpen(true);
      },
      closeConnectModal: () => setIsModalOpen(false),
      connectWallet,
      disconnectWallet,
      signMessageText,
      signAndSubmitTx,
    }),
    [
      account,
      connectWallet,
      connecting,
      disconnectWallet,
      refreshWallets,
      selectedWallet,
      signAndSubmitTx,
      signMessageText,
      walletError,
      wallets,
    ]
  );

  return (
    <SolanaWalletContext.Provider value={value}>
      {children}
      <ErrorPopup
        title="Wallet Error"
        message={walletError}
        onDismiss={() => setWalletError(null)}
      />
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Connect Solana Wallet"
        description={`Connect Phantom, Solflare, or any Wallet Standard wallet on Solana ${value.clusterLabel}.`}
      >
        <div className="space-y-4">

          {account ? (
            <div className="p-4 rounded-xl border border-border bg-surface-elevated space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">
                  Connected ({selectedWallet?.name})
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-surface border border-border text-text-secondary">
                  {value.clusterLabel}
                </span>
              </div>
              <div className="font-mono text-xs text-text break-all bg-surface p-2.5 rounded-lg border border-border">
                {account.address}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/on-chain" onClick={() => setIsModalOpen(false)}>
                  <Button variant="primary" size="sm">
                    On-Chain &amp; SBT →
                  </Button>
                </Link>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (typeof navigator !== "undefined" && navigator.clipboard) {
                      void navigator.clipboard.writeText(account.address);
                    }
                  }}
                >
                  Copy Address
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void disconnectWallet()}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          ) : wallets.length === 0 ? (
            <div className="p-5 rounded-xl border border-border bg-surface-elevated/40 text-center space-y-3">
              <p className="text-sm font-semibold text-text">
                No Solana Wallet Extension Detected
              </p>
              <p className="text-xs text-text-secondary leading-relaxed">
                Install Phantom or Solflare and switch your wallet network to Solana Devnet,
                then refresh this page.
              </p>
              <div className="flex justify-center gap-2 pt-1">
                <a
                  href="https://phantom.app/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-purple-400 hover:underline"
                >
                  Get Phantom
                </a>
                <span className="text-text-muted text-xs">·</span>
                <a
                  href="https://solflare.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-purple-400 hover:underline"
                >
                  Get Solflare
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {wallets.map((w) => (
                <button
                  key={w.name}
                  type="button"
                  disabled={connecting}
                  onClick={() => void connectWallet(w)}
                  className="w-full flex items-center justify-between p-3.5 rounded-xl border border-border bg-surface-elevated/40 hover:bg-surface-elevated hover:border-purple-500/40 transition-all cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3">
                    {w.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={w.icon}
                        alt={w.name}
                        className="w-7 h-7 rounded-lg object-contain"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-surface border border-border text-purple-400 flex items-center justify-center text-xs font-bold">
                        {w.name.slice(0, 1)}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-text">{w.name}</p>
                      <p className="text-[11px] text-text-muted">Wallet Standard · Solana</p>
                    </div>
                  </div>
                  <Badge variant="neutral" className="text-[10px]">
                    {connecting ? "Connecting..." : "Connect"}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </SolanaWalletContext.Provider>
  );
}

export function useSolanaWallet(): SolanaWalletContextValue {
  const ctx = useContext(SolanaWalletContext);
  if (!ctx) {
    throw new Error("useSolanaWallet must be used inside SolanaWalletProvider");
  }
  return ctx;
}

import { PublicKey } from "@solana/web3.js";

const textEncoder = new TextEncoder();

export interface WalletLinkChallengePayload {
  userId: string;
  walletAddress: string;
  issuedAt: string;
  nonce: string;
}

export function buildWalletLinkMessage(params: WalletLinkChallengePayload): string {
  return [
    "COOV On-Chain Identity Verification",
    `Account: ${params.userId}`,
    `Wallet: ${params.walletAddress}`,
    `Nonce: ${params.nonce}`,
    `IssuedAt: ${params.issuedAt}`,
    "Action: Link Solana wallet to COOV profile",
  ].join("\n");
}

export function parseWalletLinkMessage(message: string): WalletLinkChallengePayload | null {
  const lines = message.split("\n");
  if (lines.length < 6 || lines[0] !== "COOV On-Chain Identity Verification") {
    return null;
  }
  const getVal = (prefix: string) => {
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : "";
  };
  const userId = getVal("Account:");
  const walletAddress = getVal("Wallet:");
  const nonce = getVal("Nonce:");
  const issuedAt = getVal("IssuedAt:");

  if (!userId || !walletAddress || !nonce || !issuedAt) {
    return null;
  }

  return { userId, walletAddress, nonce, issuedAt };
}

/**
 * Verifies an Ed25519 signature from a Solana wallet using WebCrypto
 * (works identically in Node.js 20+ and Cloudflare Workers).
 */
export async function verifySolanaWalletSignature(params: {
  walletAddress: string;
  message: string;
  signatureBase64: string;
}): Promise<boolean> {
  try {
    const pubkey = new PublicKey(params.walletAddress);
    const pubkeyBytes = pubkey.toBytes();
    const signatureBytes = base64ToBytes(params.signatureBase64);
    if (pubkeyBytes.length !== 32 || signatureBytes.length !== 64) {
      return false;
    }

    const messageBytes = textEncoder.encode(params.message);
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "raw",
      pubkeyBytes as unknown as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    return await globalThis.crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      signatureBytes as unknown as BufferSource,
      messageBytes as unknown as BufferSource
    );
  } catch {
    return false;
  }
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

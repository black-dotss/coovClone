import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { formatErrorWithCause, isAppError } from "@/lib/shared/errors";

export type SolanaCluster = "devnet" | "testnet" | "mainnet-beta";

export const DEFAULT_SOLANA_PROGRAM_ID = "FXboyZZ2em2FqXrcr4Uz5nfrHHQ4K1NaJ6kP9VMBJ3Yt";
export const DEFAULT_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

function sanitizeRpcUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return cleaned;
    }
  } catch {
    // Ignore malformed URL env values and fall back safely
  }
  return null;
}

export function getSolanaCluster(): SolanaCluster {
  const raw =
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER ||
    process.env.SOLANA_CLUSTER ||
    "devnet";
  if (raw === "mainnet-beta" || raw === "testnet" || raw === "devnet") {
    return raw;
  }
  return "devnet";
}

export function getProgramId(): PublicKey {
  const raw =
    process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID ||
    DEFAULT_SOLANA_PROGRAM_ID;
  return new PublicKey(raw.trim());
}

export function getUsdcMint(): PublicKey {
  const raw =
    process.env.NEXT_PUBLIC_SOLANA_USDC_MINT ||
    DEFAULT_DEVNET_USDC_MINT;
  return new PublicKey(raw.trim());
}

export function getServerSolanaRpcCandidates(): string[] {
  const candidates = [
    sanitizeRpcUrl(process.env.SOLANA_RPC_URL),
    sanitizeRpcUrl(process.env.NEXT_PUBLIC_SOLANA_RPC_URL),
    getSolanaCluster() === "devnet" ? DEFAULT_DEVNET_RPC : null,
  ].filter((url): url is string => Boolean(url));

  const deduped = Array.from(new Set(candidates));
  return deduped.length > 0 ? deduped : [DEFAULT_DEVNET_RPC];
}

export function getServerSolanaRpcUrl(): string {
  return getServerSolanaRpcCandidates()[0];
}

export function getClientSolanaRpcUrl(): string {
  return sanitizeRpcUrl(process.env.NEXT_PUBLIC_SOLANA_RPC_URL) ?? DEFAULT_DEVNET_RPC;
}

/**
 * Creates a Solana Connection using HTTP-only RPC polling.
 */
export function getSolanaConnection(rpcUrl?: string): Connection {
  return new Connection(rpcUrl ?? getServerSolanaRpcUrl(), {
    commitment: "confirmed",
    disableRetryOnRateLimit: false,
  });
}

function isRetryableRpcTransportError(err: unknown): boolean {
  const msg = formatErrorWithCause(err);
  return /fetch failed|Failed to fetch|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR|socket|network|429|502|503|504|timeout|Too Many Requests/i.test(
    msg
  );
}

/**
 * Executes a Solana RPC workflow across configured endpoints (with automatic retry &
 * Devnet fallback if the primary RPC endpoint suffers transient fetch/network errors).
 */
export async function withSolanaConnection<T>(
  operation: (connection: Connection, rpcUrl: string) => Promise<T>
): Promise<T> {
  const endpoints = getServerSolanaRpcCandidates();
  let lastError: unknown;

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    const connection = getSolanaConnection(endpoint);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await operation(connection, endpoint);
      } catch (err) {
        if (isAppError(err)) {
          throw err;
        }
        lastError = err;
        if (!isRetryableRpcTransportError(err)) {
          throw err;
        }
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  }

  throw new Error(formatErrorWithCause(lastError ?? new Error("Solana RPC unavailable")));
}

/**
 * Parses COOV_ORACLE_PRIVATE_KEY (64-byte JSON array or base58 secret key) on the server.
 */
export function getOracleKeypair(): Keypair {
  const raw = process.env.COOV_ORACLE_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error("COOV_ORACLE_PRIVATE_KEY is not configured in environment");
  }

  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 64) {
      throw new Error("COOV_ORACLE_PRIVATE_KEY JSON array must contain 64 bytes");
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  }

  // Support base58 private key format if provided
  const decoded = decodeBase58(raw);
  if (decoded.length !== 64) {
    throw new Error("COOV_ORACLE_PRIVATE_KEY must decode to 64 bytes");
  }
  return Keypair.fromSecretKey(decoded);
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map(BASE58_ALPHABET.split("").map((ch, idx) => [ch, idx]));

export function decodeBase58(input: string): Uint8Array {
  if (!input) return new Uint8Array(0);
  const bytes = [0];
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const value = BASE58_MAP.get(char);
    if (value === undefined) {
      throw new Error(`Invalid base58 character at index ${i}`);
    }
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] *= 58;
    }
    bytes[0] += value;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < input.length && input[i] === "1"; i++) {
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

/**
 * Confirms a transaction signature using HTTP `getSignatureStatuses` polling
 * instead of WebSocket subscriptions so it works in Cloudflare Workers.
 */
export async function confirmSignatureViaPolling(
  connection: Connection,
  signature: string,
  timeoutMs = 45_000
): Promise<{ confirmed: boolean; slot?: number; err?: unknown }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusRes = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statusRes.value[0];
    if (status) {
      if (status.err) {
        return { confirmed: false, slot: status.slot, err: status.err };
      }
      if (
        status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized"
      ) {
        return { confirmed: true, slot: status.slot };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return { confirmed: false, err: "Transaction confirmation timed out" };
}

export function getExplorerTxUrl(signature: string, cluster: SolanaCluster = getSolanaCluster()): string {
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${clusterParam}`;
}

export function getExplorerAddressUrl(address: string, cluster: SolanaCluster = getSolanaCluster()): string {
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${clusterParam}`;
}

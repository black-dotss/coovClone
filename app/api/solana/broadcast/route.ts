import { SendTransactionError, Transaction } from "@solana/web3.js";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  BadRequestError,
  createApiHandler,
  formatErrorWithCause,
  isAppError,
  successResponse,
} from "@/lib/shared";
import { withSolanaConnection } from "@/lib/solana";

const BroadcastSchema = z.object({
  signedTxBase64: z.string().min(64).max(4096),
});

function formatSolanaBroadcastError(rawMessage: string, logs: string[]): string {
  const combined = `${rawMessage}\n${logs.join("\n")}`;
  if (/Blockhash not found/i.test(combined)) {
    return "Solana transaction blockhash expired before broadcast. Click Submit again to sign with a fresh blockhash.";
  }
  if (/Attempt to debit an account but found no record of a prior credit/i.test(combined)) {
    return "Your connected Solana wallet has 0 Devnet SOL to pay network fees/rent. Fund your wallet with Devnet SOL and retry.";
  }
  if (/insufficient funds|insufficient lamports|custom program error:\s*0x1\b|"Custom":1\b/i.test(combined)) {
    return "Insufficient Devnet USDC or SOL balance in your wallet to complete this transaction.";
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(combined)) {
    return "Solana Devnet RPC connection timed out while broadcasting your transaction. Please retry in a few seconds.";
  }

  // Extract explicit Anchor Error Message if present in logs
  const anchorErrLine = logs.find((l) => l.includes("Error Message:"));
  if (anchorErrLine) {
    const match = anchorErrLine.match(/Error Message:\s*(.+)$/);
    if (match?.[1]) {
      return `Program rejected transaction: ${match[1].trim()}`;
    }
  }

  // Strip noisy Solana SDK developer instructions from raw simulation errors
  return rawMessage
    .replace(/\s*Catch the `SendTransactionError`[\s\S]*$/i, "")
    .trim();
}

export const POST = createApiHandler(async (req: Request) => {
  await requireAuth(req.headers);
  const body = await req.json();
  const parsed = BroadcastSchema.parse(body);

  const rawBytes = Uint8Array.from(atob(parsed.signedTxBase64), (c) => c.charCodeAt(0));
  if (rawBytes.length < 64 || rawBytes.length > 2048) {
    throw new BadRequestError("Invalid serialized Solana transaction payload.");
  }

  try {
    Transaction.from(rawBytes);
  } catch {
    throw new BadRequestError("Malformed Solana transaction bytes.");
  }

  try {
    const signature = await withSolanaConnection(async (connection) => {
      try {
        return await connection.sendRawTransaction(rawBytes, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });
      } catch (err) {
        if (err instanceof SendTransactionError) {
          let logs: string[] = [];
          try {
            logs = (await err.getLogs(connection)) ?? err.logs ?? [];
          } catch {
            logs = err.logs ?? [];
          }
          throw new BadRequestError(formatSolanaBroadcastError(err.message, logs));
        }
        throw err;
      }
    });

    return successResponse({ signature });
  } catch (err) {
    if (isAppError(err)) throw err;
    throw new BadRequestError(formatSolanaBroadcastError(formatErrorWithCause(err), []));
  }
});

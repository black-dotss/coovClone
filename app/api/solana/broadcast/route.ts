import { Transaction } from "@solana/web3.js";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { BadRequestError, createApiHandler, successResponse } from "@/lib/shared";
import { getSolanaConnection } from "@/lib/solana";

const BroadcastSchema = z.object({
  signedTxBase64: z.string().min(64).max(4096),
});

export const POST = createApiHandler(async (req: Request) => {
  await requireAuth(req.headers);
  const body = await req.json();
  const parsed = BroadcastSchema.parse(body);

  const rawBytes = Uint8Array.from(atob(parsed.signedTxBase64), (c) => c.charCodeAt(0));
  if (rawBytes.length < 64 || rawBytes.length > 2048) {
    throw new BadRequestError("Invalid serialized Solana transaction payload.");
  }

  // Basic structural sanity check before forwarding to cluster RPC
  try {
    Transaction.from(rawBytes);
  } catch {
    throw new BadRequestError("Malformed Solana transaction bytes.");
  }

  const connection = getSolanaConnection();
  const signature = await connection.sendRawTransaction(rawBytes, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });

  return successResponse({ signature });
});

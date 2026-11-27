import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { BadRequestError, createApiHandler, successResponse } from "@/lib/shared";
import {
  decodeEvaluationRecord,
  deriveEvaluationPda,
  getExplorerAddressUrl,
  getSolanaCluster,
  getSolanaConnection,
} from "@/lib/solana";

const QuerySchema = z.object({
  wallet: z.string().min(32).max(64),
  evalId: z.string().uuid(),
});

/**
 * Public read-only endpoint returning live on-chain EvaluationRecord PDA bytes and
 * decoded proof fields via server RPC so public /share/[token] pages never hit 429 limits.
 */
export const GET = createApiHandler(async (req: Request) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.parse({
    wallet: url.searchParams.get("wallet") || "",
    evalId: url.searchParams.get("evalId") || "",
  });

  let walletPubkey: PublicKey;
  try {
    walletPubkey = new PublicKey(parsed.wallet);
  } catch {
    throw new BadRequestError("Invalid Solana wallet address");
  }

  const connection = getSolanaConnection();
  const [evalPda] = deriveEvaluationPda(walletPubkey, parsed.evalId);
  const info = await connection.getAccountInfo(evalPda, "confirmed");

  if (!info) {
    return successResponse({
      exists: false,
      cluster: getSolanaCluster(),
      evalPda: evalPda.toBase58(),
      evalPdaUrl: getExplorerAddressUrl(evalPda.toBase58()),
      record: null,
    });
  }

  const record = decodeEvaluationRecord(info.data);
  return successResponse({
    exists: true,
    cluster: getSolanaCluster(),
    evalPda: evalPda.toBase58(),
    evalPdaUrl: getExplorerAddressUrl(evalPda.toBase58()),
    record,
  });
});

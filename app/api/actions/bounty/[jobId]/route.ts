import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  ACTIONS_CORS_HEADERS,
  BLOCKCHAIN_IDS,
  MEMO_PROGRAM_ID,
  createPostResponse,
  type ActionError,
  type ActionGetResponse,
  type ActionPostRequest,
} from "@solana/actions";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { bounties, jobDescriptions } from "@/lib/db/schema";
import {
  buildCreateBountyEscrowIx,
  deriveEscrowPda,
  deriveEscrowVaultPda,
  fetchOnChainEscrow,
  getProgramId,
  getSolanaCluster,
  getUsdcMint,
  withSolanaConnection,
} from "@/lib/solana";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getActionHeaders(): Record<string, string> {
  const cluster = getSolanaCluster();
  const chainId =
    cluster === "mainnet-beta"
      ? BLOCKCHAIN_IDS.mainnet
      : cluster === "testnet"
      ? BLOCKCHAIN_IDS.testnet
      : BLOCKCHAIN_IDS.devnet;

  return {
    ...ACTIONS_CORS_HEADERS,
    "X-Action-Version": "2.2",
    "X-Blockchain-Ids": chainId,
  };
}

function actionErrorResponse(message: string, status = 400): Response {
  const body: ActionError = { message };
  return Response.json(body, { status, headers: getActionHeaders() });
}

function resolveActionIconUrl(origin: string, companyLogoUrl?: string | null): string {
  if (companyLogoUrl && /^https?:\/\//i.test(companyLogoUrl.trim())) {
    return companyLogoUrl.trim();
  }
  return `${origin}/doll/sol.png`;
}

async function lookupBountyRecord(jobIdOrBountyId: string) {
  if (!UUID_REGEX.test(jobIdOrBountyId)) {
    return null;
  }

  const rows = await db
    .select({
      id: bounties.id,
      jobDescriptionId: bounties.jobDescriptionId,
      recruiterWallet: bounties.recruiterWallet,
      title: bounties.title,
      company: bounties.company,
      companyLogoUrl: bounties.companyLogoUrl,
      usdcMint: bounties.usdcMint,
      escrowPdaAddress: bounties.escrowPdaAddress,
      vaultAddress: bounties.vaultAddress,
      minScore: bounties.minScore,
      rewardPerWinnerMicros: bounties.rewardPerWinnerMicros,
      maxWinners: bounties.maxWinners,
      claimsCount: bounties.claimsCount,
      status: bounties.status,
      expiresAt: bounties.expiresAt,
      rawText: jobDescriptions.rawText,
    })
    .from(bounties)
    .innerJoin(jobDescriptions, eq(bounties.jobDescriptionId, jobDescriptions.id))
    .where(
      or(eq(bounties.jobDescriptionId, jobIdOrBountyId), eq(bounties.id, jobIdOrBountyId))
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: getActionHeaders(),
  });
}

/**
 * GET /api/actions/bounty/[jobId]
 * Solana Actions / Blinks metadata endpoint for inspecting live USDC escrow state
 * or funding a new bounty escrow PDA via wallet action.
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  if (!UUID_REGEX.test(jobId)) {
    return actionErrorResponse("Invalid bounty jobId (expected UUID).", 400);
  }

  const reqUrl = new URL(req.url);
  const origin = reqUrl.origin;
  const programId = getProgramId();
  const usdcMint = getUsdcMint();

  const [bounty, onChain] = await Promise.all([
    lookupBountyRecord(jobId).catch(() => null),
    fetchOnChainEscrow(jobId).catch(() => ({
      escrowPda: deriveEscrowPda(jobId, programId)[0].toBase58(),
      vaultPda: deriveEscrowVaultPda(deriveEscrowPda(jobId, programId)[0], programId)[0].toBase58(),
      escrow: null,
    })),
  ]);

  const effectiveJobId = bounty?.jobDescriptionId ?? jobId;
  const icon = resolveActionIconUrl(origin, bounty?.companyLogoUrl);

  if (bounty || onChain.escrow) {
    const rewardMicros = Number(
      onChain.escrow?.rewardPerWinnerMicros ?? bounty?.rewardPerWinnerMicros ?? "0"
    );
    const rewardUsdc = rewardMicros / 1_000_000;
    const maxWinners = onChain.escrow?.maxWinners ?? bounty?.maxWinners ?? 1;
    const claimsCount = onChain.escrow?.claimsCount ?? bounty?.claimsCount ?? 0;
    const minScore = onChain.escrow?.minScore ?? bounty?.minScore ?? 85;
    const stakeBps = onChain.escrow?.stakeBps ?? 1000;
    const stakeUsdc = ((rewardUsdc * stakeBps) / 10_000).toFixed(2);
    const slashedUsdc = (Number(onChain.escrow?.slashedPoolAmountMicros ?? "0") / 1_000_000).toFixed(2);
    const totalPoolUsdc = rewardUsdc * maxWinners;
    const escrowStatus = onChain.escrow?.isClosed
      ? "CLOSED"
      : (bounty?.status ?? "ACTIVE").toUpperCase();

    const payload: ActionGetResponse = {
      type: "action",
      icon,
      title: bounty
        ? `${bounty.title} — ${bounty.company} (${rewardUsdc} USDC)`
        : `COOV Bounty Escrow (${rewardUsdc} USDC / winner)`,
      description: [
        `Status: ${escrowStatus} · Slots: ${claimsCount}/${maxWinners} claimed (${totalPoolUsdc.toFixed(2)} USDC pool).`,
        `Min AI Bar: ${minScore}/100 · Conviction Stake: ${stakeUsdc} USDC (${(stakeBps / 100).toFixed(1)}%) · Slashed Spam Yield: +${slashedUsdc} USDC.`,
        `Escrow PDA: ${onChain.escrowPda} · Vault PDA: ${onChain.vaultPda}.`,
      ].join(" "),
      label: "Inspect Escrow On-Chain",
      links: {
        actions: [
          {
            type: "transaction",
            label: `Attest Audit on Chain (${claimsCount}/${maxWinners} slots)`,
            href: `${origin}/api/actions/bounty/${effectiveJobId}?mode=inspect`,
          },
        ],
      },
    };

    return Response.json(payload, { headers: getActionHeaders() });
  }

  // Unfunded job UUID -> expose direct escrow funding Blink form
  const payload: ActionGetResponse = {
    type: "action",
    icon,
    title: `Fund COOV USDC Bounty Escrow`,
    description: [
      `Lock Devnet USDC (${usdcMint.toBase58()}) into Escrow PDA ${onChain.escrowPda} under COOV Program ${programId.toBase58()}.`,
      `Vault PDA: ${onChain.vaultPda}.`,
    ].join(" "),
    label: "Fund Escrow Pool",
    links: {
      actions: [
        {
          type: "transaction",
          label: "Fund Bounty Escrow (USDC)",
          href: `${origin}/api/actions/bounty/${effectiveJobId}?mode=fund&rewardUsdc={rewardUsdc}&maxWinners={maxWinners}&minScore={minScore}&stakePct={stakePct}&days={days}`,
          parameters: [
            {
              name: "rewardUsdc",
              label: "Reward per Winner (USDC)",
              required: true,
              type: "number",
              min: 0.1,
              max: 100000,
            },
            {
              name: "maxWinners",
              label: "Winner Slots (1-100)",
              required: true,
              type: "number",
              min: 1,
              max: 100,
            },
            {
              name: "minScore",
              label: "Minimum AI Score (50-100)",
              required: true,
              type: "number",
              min: 50,
              max: 100,
            },
            {
              name: "stakePct",
              label: "Conviction Stake % (Default 10%)",
              required: false,
              type: "number",
              min: 1,
              max: 100,
            },
            {
              name: "days",
              label: "Duration (Days, 1-180)",
              required: false,
              type: "number",
              min: 1,
              max: 180,
            },
          ],
        },
      ],
    },
  };

  return Response.json(payload, { headers: getActionHeaders() });
}

/**
 * POST /api/actions/bounty/[jobId]
 * Builds either:
 *  - `mode=fund`: an Anchor `create_bounty_escrow` transaction locking Devnet USDC into EscrowVault PDA, or
 *  - `mode=inspect`: a verifiable on-chain SPL Memo attestation summarizing live Escrow PDA state.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  if (!UUID_REGEX.test(jobId)) {
    return actionErrorResponse("Invalid bounty jobId (expected UUID).", 400);
  }

  let body: ActionPostRequest;
  try {
    body = (await req.json()) as ActionPostRequest;
  } catch {
    return actionErrorResponse("Invalid JSON request body.", 400);
  }

  let walletPubkey: PublicKey;
  try {
    if (!body?.account) {
      return actionErrorResponse("Missing signer `account` public key.", 400);
    }
    walletPubkey = new PublicKey(body.account);
  } catch {
    return actionErrorResponse("Invalid Solana `account` public key.", 400);
  }

  const reqUrl = new URL(req.url);
  const modeParam = reqUrl.searchParams.get("mode")?.toLowerCase();
  const programId = getProgramId();
  const usdcMint = getUsdcMint();

  const [bounty, onChain] = await Promise.all([
    lookupBountyRecord(jobId).catch(() => null),
    fetchOnChainEscrow(jobId).catch(() => ({
      escrowPda: deriveEscrowPda(jobId, programId)[0].toBase58(),
      vaultPda: deriveEscrowVaultPda(deriveEscrowPda(jobId, programId)[0], programId)[0].toBase58(),
      escrow: null,
    })),
  ]);

  const effectiveJobId = bounty?.jobDescriptionId ?? jobId;
  const effectiveMode = modeParam ?? (onChain.escrow ? "inspect" : "fund");

  if (effectiveMode === "fund") {
    if (onChain.escrow) {
      return actionErrorResponse(
        `Escrow PDA (${onChain.escrowPda}) is already funded on-chain for job ${effectiveJobId}. Switch to mode=inspect to audit.`,
        409
      );
    }

    const rewardUsdc = Number(reqUrl.searchParams.get("rewardUsdc") ?? "5");
    const maxWinners = Math.round(Number(reqUrl.searchParams.get("maxWinners") ?? "3"));
    const minScore = Math.round(Number(reqUrl.searchParams.get("minScore") ?? "85"));
    const stakePct = Number(reqUrl.searchParams.get("stakePct") ?? "10");
    const days = Math.round(Number(reqUrl.searchParams.get("days") ?? "30"));

    if (!Number.isFinite(rewardUsdc) || rewardUsdc <= 0) {
      return actionErrorResponse("`rewardUsdc` must be greater than 0.", 400);
    }
    if (!Number.isInteger(maxWinners) || maxWinners < 1 || maxWinners > 100) {
      return actionErrorResponse("`maxWinners` must be between 1 and 100.", 400);
    }
    if (!Number.isInteger(minScore) || minScore < 50 || minScore > 100) {
      return actionErrorResponse("`minScore` must be between 50 and 100.", 400);
    }
    if (!Number.isFinite(stakePct) || stakePct < 1 || stakePct > 100) {
      return actionErrorResponse("`stakePct` must be between 1 and 100.", 400);
    }
    if (!Number.isInteger(days) || days < 1 || days > 180) {
      return actionErrorResponse("`days` must be between 1 and 180.", 400);
    }

    const stakeBps = Math.round(stakePct * 100);
    const rewardPerWinnerMicros = BigInt(Math.round(rewardUsdc * 1_000_000));
    const expiresAtUnix = Math.floor(Date.now() / 1000) + days * 86_400;

    try {
      const result = await withSolanaConnection(async (connection) => {
        const mintInfo = await connection.getAccountInfo(usdcMint, "confirmed");
        if (!mintInfo) {
          throw new Error(`USDC Mint ${usdcMint.toBase58()} not found on ${getSolanaCluster()}.`);
        }

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
        const tx = new Transaction({
          feePayer: walletPubkey,
          blockhash,
          lastValidBlockHeight,
        }).add(
          buildCreateBountyEscrowIx({
            recruiter: walletPubkey,
            usdcMint,
            jobId: effectiveJobId,
            minScore,
            rewardPerWinnerMicros,
            maxWinners,
            expiresAtUnix,
            stakeBps,
            tokenProgramId: mintInfo.owner,
            programId,
          })
        );

        const [escrowPda] = deriveEscrowPda(effectiveJobId, programId);
        return createPostResponse({
          fields: {
            type: "transaction",
            transaction: tx,
            message: `Fund ${(rewardUsdc * maxWinners).toFixed(2)} Devnet USDC into Escrow PDA ${escrowPda.toBase58()} (${maxWinners} slots @ min score ${minScore}/100).`,
          },
        });
      });

      return Response.json(result, { headers: getActionHeaders() });
    } catch (err) {
      return actionErrorResponse(
        err instanceof Error ? err.message : "Failed to construct create_bounty_escrow transaction.",
        400
      );
    }
  }

  // mode=inspect: construct verifiable Memo audit transaction citing exact PDA & vault state
  const claims = onChain.escrow?.claimsCount ?? bounty?.claimsCount ?? 0;
  const maxW = onChain.escrow?.maxWinners ?? bounty?.maxWinners ?? 0;
  const minS = onChain.escrow?.minScore ?? bounty?.minScore ?? 0;
  const memoText = `COOV_ESCROW_INSPECT|job=${effectiveJobId}|escrow=${onChain.escrowPda}|vault=${onChain.vaultPda}|slots=${claims}/${maxW}|minScore=${minS}`;

  try {
    const result = await withSolanaConnection(async (connection) => {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: walletPubkey,
        blockhash,
        lastValidBlockHeight,
      }).add(
        new TransactionInstruction({
          programId: new PublicKey(MEMO_PROGRAM_ID),
          keys: [{ pubkey: walletPubkey, isSigner: true, isWritable: false }],
          data: Buffer.from(memoText, "utf8"),
        })
      );

      return createPostResponse({
        fields: {
          type: "transaction",
          transaction: tx,
          message: `Verified COOV Escrow PDA ${onChain.escrowPda} (${claims}/${maxW} slots, min score ${minS}/100).`,
        },
      });
    });

    return Response.json(result, { headers: getActionHeaders() });
  } catch (err) {
    return actionErrorResponse(
      err instanceof Error ? err.message : "Failed to build escrow inspection transaction.",
      400
    );
  }
}

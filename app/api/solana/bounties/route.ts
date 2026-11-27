import { PublicKey } from "@solana/web3.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bounties, bountyClaims, evaluations, jobDescriptions } from "@/lib/db/schema";
import { getSession, requireAuth } from "@/lib/auth";
import { createJobDescription } from "@/lib/job-descriptions";
import {
  BadRequestError,
  createApiHandler,
  successResponse,
} from "@/lib/shared";
import {
  confirmSubmittedSignature,
  fetchOnChainEscrow,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getSolanaCluster,
  prepareCreateBountyEscrowTx,
} from "@/lib/solana";

const PrepareBountySchema = z.object({
  title: z.string().min(2).max(120),
  company: z.string().min(1).max(120),
  rawText: z.string().min(30).max(25000),
  recruiterWallet: z.string().min(32).max(64),
  minScore: z.number().int().min(50).max(100),
  rewardPerWinnerUsdc: z.number().positive().max(100_000),
  maxWinners: z.number().int().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(180).default(30),
});

const ConfirmBountySchema = z.object({
  jobDescriptionId: z.string().uuid(),
  recruiterWallet: z.string().min(32).max(64),
  title: z.string().min(2).max(120),
  company: z.string().min(1).max(120),
  txSignature: z.string().min(32).max(128),
});

export const GET = createApiHandler(async (req: Request) => {
  const session = await getSession(req.headers);

  const rows = await db
    .select({
      id: bounties.id,
      recruiterUserId: bounties.recruiterUserId,
      recruiterWallet: bounties.recruiterWallet,
      jobDescriptionId: bounties.jobDescriptionId,
      title: bounties.title,
      company: bounties.company,
      usdcMint: bounties.usdcMint,
      escrowPdaAddress: bounties.escrowPdaAddress,
      vaultAddress: bounties.vaultAddress,
      createTxSignature: bounties.createTxSignature,
      refundTxSignature: bounties.refundTxSignature,
      minScore: bounties.minScore,
      rewardPerWinnerMicros: bounties.rewardPerWinnerMicros,
      maxWinners: bounties.maxWinners,
      claimsCount: bounties.claimsCount,
      status: bounties.status,
      expiresAt: bounties.expiresAt,
      createdAt: bounties.createdAt,
      rawText: jobDescriptions.rawText,
    })
    .from(bounties)
    .innerJoin(jobDescriptions, eq(bounties.jobDescriptionId, jobDescriptions.id))
    .orderBy(desc(bounties.createdAt));

  // Sync live claims/closed status for open bounties
  const syncedRows = await Promise.all(
    rows.map(async (row) => {
      let claimsCount = row.claimsCount;
      let status = row.status;
      if (status === "active") {
        try {
          const onChain = await fetchOnChainEscrow(row.jobDescriptionId);
          if (onChain.escrow) {
            claimsCount = onChain.escrow.claimsCount;
            if (onChain.escrow.isClosed) {
              status = claimsCount >= row.maxWinners ? "filled" : "refunded";
            } else if (claimsCount >= row.maxWinners) {
              status = "filled";
            } else if (row.expiresAt.getTime() < Date.now()) {
              status = "expired";
            }
          }
        } catch {
          // Keep DB state if RPC is temporarily unreachable
        }
      }

      return {
        ...row,
        claimsCount,
        status,
        isExpired: row.expiresAt.getTime() < Date.now(),
        rewardPerWinnerUsdc: Number(row.rewardPerWinnerMicros) / 1_000_000,
        totalPoolUsdc:
          (Number(row.rewardPerWinnerMicros) * row.maxWinners) / 1_000_000,
        escrowUrl: getExplorerAddressUrl(row.escrowPdaAddress),
        txUrl: row.createTxSignature ? getExplorerTxUrl(row.createTxSignature) : null,
      };
    })
  );

  let myEvaluations: Array<{
    id: string;
    jobDescriptionId: string;
    status: string;
    overallScore: number | null;
    candidateWallet: string | null;
    evalTxSignature: string | null;
  }> = [];
  let myClaims: Array<{
    bountyId: string;
    claimTxSignature: string;
    amountMicros: string;
    candidateWallet: string;
  }> = [];

  if (session?.user?.id) {
    [myEvaluations, myClaims] = await Promise.all([
      db
        .select({
          id: evaluations.id,
          jobDescriptionId: evaluations.jobDescriptionId,
          status: evaluations.status,
          overallScore: evaluations.overallScore,
          candidateWallet: evaluations.candidateWallet,
          evalTxSignature: evaluations.evalTxSignature,
        })
        .from(evaluations)
        .where(eq(evaluations.ownerUserId, session.user.id))
        .orderBy(desc(evaluations.createdAt)),
      db
        .select({
          bountyId: bountyClaims.bountyId,
          claimTxSignature: bountyClaims.claimTxSignature,
          amountMicros: bountyClaims.amountMicros,
          candidateWallet: bountyClaims.candidateWallet,
        })
        .from(bountyClaims)
        .where(eq(bountyClaims.candidateUserId, session.user.id)),
    ]);
  }

  return successResponse({
    cluster: getSolanaCluster(),
    currentUserId: session?.user?.id ?? null,
    bounties: syncedRows,
    myEvaluations,
    myClaims,
  });
});

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const parsed = PrepareBountySchema.parse(body);

  let recruiterWallet: string;
  try {
    recruiterWallet = new PublicKey(parsed.recruiterWallet).toBase58();
  } catch {
    throw new BadRequestError("Invalid recruiter Solana wallet address");
  }

  const rewardPerWinnerMicros = BigInt(
    Math.round(parsed.rewardPerWinnerUsdc * 1_000_000)
  );
  if (rewardPerWinnerMicros < BigInt(10_000)) {
    throw new BadRequestError("Minimum bounty reward per winner is 0.01 USDC.");
  }

  const jd = await createJobDescription(session.user.id, {
    title: parsed.title,
    company: parsed.company,
    rawText: parsed.rawText,
  });

  const expiresAtUnix = Math.floor(Date.now() / 1000) + parsed.expiresInDays * 86_400;

  const prepared = await prepareCreateBountyEscrowTx({
    recruiterWallet,
    jobId: jd.id,
    minScore: parsed.minScore,
    rewardPerWinnerMicros,
    maxWinners: parsed.maxWinners,
    expiresAtUnix,
  });

  return successResponse(
    {
      jobDescriptionId: jd.id,
      title: parsed.title,
      company: parsed.company,
      minScore: parsed.minScore,
      maxWinners: parsed.maxWinners,
      rewardPerWinnerMicros: rewardPerWinnerMicros.toString(),
      expiresAtUnix,
      ...prepared,
    },
    { status: 201 }
  );
});

export const PATCH = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const parsed = ConfirmBountySchema.parse(body);

  let recruiterWallet: string;
  try {
    recruiterWallet = new PublicKey(parsed.recruiterWallet).toBase58();
  } catch {
    throw new BadRequestError("Invalid recruiter wallet address");
  }

  const [jd] = await db
    .select({ id: jobDescriptions.id, userId: jobDescriptions.userId })
    .from(jobDescriptions)
    .where(
      and(
        eq(jobDescriptions.id, parsed.jobDescriptionId),
        eq(jobDescriptions.userId, session.user.id)
      )
    )
    .limit(1);

  if (!jd) {
    throw new BadRequestError("Bounty Job Description not found for current user.");
  }

  await confirmSubmittedSignature(parsed.txSignature);
  const escrowRes = await fetchOnChainEscrow(jd.id);
  if (!escrowRes.escrow) {
    throw new BadRequestError(
      "Transaction confirmed, but BountyEscrow PDA was not found on-chain."
    );
  }

  const [existing] = await db
    .select()
    .from(bounties)
    .where(eq(bounties.jobDescriptionId, jd.id))
    .limit(1);

  if (existing) {
    return successResponse(existing);
  }

  const [created] = await db
    .insert(bounties)
    .values({
      recruiterUserId: session.user.id,
      recruiterWallet,
      jobDescriptionId: jd.id,
      title: parsed.title,
      company: parsed.company,
      usdcMint: escrowRes.escrow.usdcMint,
      escrowPdaAddress: escrowRes.escrowPda,
      vaultAddress: escrowRes.vaultPda,
      createTxSignature: parsed.txSignature,
      minScore: escrowRes.escrow.minScore,
      rewardPerWinnerMicros: escrowRes.escrow.rewardPerWinnerMicros,
      maxWinners: escrowRes.escrow.maxWinners,
      claimsCount: escrowRes.escrow.claimsCount,
      status: "active",
      expiresAt: new Date(escrowRes.escrow.expiresAt * 1000),
    })
    .returning();

  return successResponse({
    ...created,
    txUrl: getExplorerTxUrl(parsed.txSignature),
    escrowUrl: getExplorerAddressUrl(escrowRes.escrowPda),
  });
});

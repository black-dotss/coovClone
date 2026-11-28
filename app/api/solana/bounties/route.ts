import { PublicKey } from "@solana/web3.js";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import {
  bounties,
  bountyClaims,
  bountyRestrictions,
  bountySubmissions,
  evaluations,
  jobDescriptions,
} from "@/lib/db/schema";
import { formatRemainingDuration, RESERVED_SUBMISSION_STATUSES } from "@/lib/bounties/service";
import { getSession, requireAuth } from "@/lib/auth";
import { createJobDescription } from "@/lib/job-descriptions";
import {
  BadRequestError,
  createApiHandler,
  formatErrorWithCause,
  isAppError,
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

const LOGO_URL_REGEX = /^(https?:\/\/\S+|data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+)$/i;

const PrepareBountySchema = z.object({
  title: z.string().min(2).max(120),
  company: z.string().min(1).max(120),
  companyLogoUrl: z
    .string()
    .max(350_000)
    .refine((val) => !val || LOGO_URL_REGEX.test(val.trim()), {
      message: "Company logo must be a valid image URL or base64 PNG/JPEG/WEBP data URL.",
    })
    .optional()
    .nullable(),
  rawText: z.string().min(50, "Job description must be at least 50 characters.").max(25000),
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
  companyLogoUrl: z
    .string()
    .max(350_000)
    .refine((val) => !val || LOGO_URL_REGEX.test(val.trim()), {
      message: "Company logo must be a valid image URL or base64 PNG/JPEG/WEBP data URL.",
    })
    .optional()
    .nullable(),
  txSignature: z.string().min(32).max(128),
});

export const GET = createApiHandler(async (req: Request) => {
  const session = await getSession(req.headers);
  const url = new URL(req.url);
  const walletParam = url.searchParams.get("wallet")?.trim() || null;

  const rows = await db
    .select({
      id: bounties.id,
      recruiterUserId: bounties.recruiterUserId,
      recruiterWallet: bounties.recruiterWallet,
      jobDescriptionId: bounties.jobDescriptionId,
      title: bounties.title,
      company: bounties.company,
      companyLogoUrl: bounties.companyLogoUrl,
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

  const bountyIds = rows.map((r) => r.id);
  const activeReservations =
    bountyIds.length > 0
      ? await db
          .select({
            bountyId: bountySubmissions.bountyId,
            reviewStatus: bountySubmissions.reviewStatus,
          })
          .from(bountySubmissions)
          .where(
            and(
              inArray(bountySubmissions.bountyId, bountyIds),
              inArray(bountySubmissions.reviewStatus, [...RESERVED_SUBMISSION_STATUSES])
            )
          )
      : [];

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

      const reservedForBounty = activeReservations.filter((r) => r.bountyId === row.id);
      const pendingReviewCount = reservedForBounty.filter(
        (r) => r.reviewStatus === "pending_review"
      ).length;
      const approvedCount = reservedForBounty.filter(
        (r) => r.reviewStatus === "approved"
      ).length;
      const occupiedSlots = claimsCount + reservedForBounty.length;
      const availableSlots = Math.max(0, row.maxWinners - occupiedSlots);

      return {
        ...row,
        claimsCount,
        status,
        pendingReviewCount,
        approvedCount,
        occupiedSlots,
        availableSlots,
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
  let mySubmissions: Array<{
    id: string;
    bountyId: string;
    evaluationId: string;
    candidateWallet: string | null;
    resumeHash: string;
    fakeDetectorStatus: string;
    fakeDetectorScore: number | null;
    reviewStatus: string;
    slotReservedAt: string | null;
    reviewDeadlineAt: string | null;
    recruiterNotes: string | null;
    isReviewExpired: boolean;
    remainingReviewLabel: string | null;
  }> = [];
  let myRestrictions: Array<{
    bountyId: string;
    reason: string;
    details: string;
    createdAt: string;
  }> = [];

  if (session?.user?.id || walletParam) {
    const restrictionConds = [];
    if (session?.user?.id) restrictionConds.push(eq(bountyRestrictions.userId, session.user.id));
    if (walletParam) restrictionConds.push(eq(bountyRestrictions.walletAddress, walletParam));

    const [evalRows, claimRows, subRows, restrictionRows] = await Promise.all([
      session?.user?.id
        ? db
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
            .orderBy(desc(evaluations.createdAt))
        : Promise.resolve([]),
      session?.user?.id
        ? db
            .select({
              bountyId: bountyClaims.bountyId,
              claimTxSignature: bountyClaims.claimTxSignature,
              amountMicros: bountyClaims.amountMicros,
              candidateWallet: bountyClaims.candidateWallet,
            })
            .from(bountyClaims)
            .where(eq(bountyClaims.candidateUserId, session.user.id))
        : Promise.resolve([]),
      session?.user?.id
        ? db
            .select({
              id: bountySubmissions.id,
              bountyId: bountySubmissions.bountyId,
              evaluationId: bountySubmissions.evaluationId,
              candidateWallet: bountySubmissions.candidateWallet,
              resumeHash: bountySubmissions.resumeHash,
              fakeDetectorStatus: bountySubmissions.fakeDetectorStatus,
              fakeDetectorScore: bountySubmissions.fakeDetectorScore,
              reviewStatus: bountySubmissions.reviewStatus,
              slotReservedAt: bountySubmissions.slotReservedAt,
              reviewDeadlineAt: bountySubmissions.reviewDeadlineAt,
              recruiterNotes: bountySubmissions.recruiterNotes,
            })
            .from(bountySubmissions)
            .where(eq(bountySubmissions.candidateUserId, session.user.id))
            .orderBy(desc(bountySubmissions.createdAt))
        : Promise.resolve([]),
      restrictionConds.length > 0
        ? db
            .select({
              bountyId: bountyRestrictions.bountyId,
              reason: bountyRestrictions.reason,
              details: bountyRestrictions.details,
              createdAt: bountyRestrictions.createdAt,
            })
            .from(bountyRestrictions)
            .where(or(...restrictionConds))
            .orderBy(desc(bountyRestrictions.createdAt))
        : Promise.resolve([]),
    ]);

    myEvaluations = evalRows;
    myClaims = claimRows;

    const nowMs = Date.now();
    mySubmissions = subRows.map((s) => {
      const deadlineMs = s.reviewDeadlineAt ? s.reviewDeadlineAt.getTime() : null;
      const isReviewExpired = Boolean(
        s.reviewStatus === "pending_review" && deadlineMs !== null && nowMs >= deadlineMs
      );
      return {
        ...s,
        slotReservedAt: s.slotReservedAt ? s.slotReservedAt.toISOString() : null,
        reviewDeadlineAt: s.reviewDeadlineAt ? s.reviewDeadlineAt.toISOString() : null,
        isReviewExpired,
        remainingReviewLabel:
          deadlineMs && nowMs < deadlineMs
            ? formatRemainingDuration(deadlineMs, nowMs)
            : isReviewExpired
            ? "Deadline expired (Auto-claim ready)"
            : null,
      };
    });

    myRestrictions = restrictionRows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  return successResponse({
    cluster: getSolanaCluster(),
    currentUserId: session?.user?.id ?? null,
    bounties: syncedRows,
    myEvaluations,
    myClaims,
    mySubmissions,
    myRestrictions,
  });
});

function rethrowReadableError(err: unknown, context: string): never {
  if (isAppError(err) || err instanceof ZodError) {
    throw err;
  }
  throw new BadRequestError(`${context}: ${formatErrorWithCause(err)}`);
}

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

  let jd: Awaited<ReturnType<typeof createJobDescription>>;
  try {
    jd = await createJobDescription(session.user.id, {
      title: parsed.title,
      company: parsed.company,
      rawText: parsed.rawText,
    });
  } catch (err) {
    rethrowReadableError(err, "Failed to save bounty job description");
  }

  const expiresAtUnix = Math.floor(Date.now() / 1000) + parsed.expiresInDays * 86_400;

  let prepared: Awaited<ReturnType<typeof prepareCreateBountyEscrowTx>>;
  try {
    prepared = await prepareCreateBountyEscrowTx({
      recruiterWallet,
      jobId: jd.id,
      minScore: parsed.minScore,
      rewardPerWinnerMicros,
      maxWinners: parsed.maxWinners,
      expiresAtUnix,
    });
  } catch (err) {
    rethrowReadableError(err, "Failed to prepare Solana escrow transaction");
  }

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

  let escrowRes: Awaited<ReturnType<typeof fetchOnChainEscrow>>;
  try {
    await confirmSubmittedSignature(parsed.txSignature);
    escrowRes = await fetchOnChainEscrow(jd.id);
  } catch (err) {
    rethrowReadableError(err, "Failed to verify Solana escrow transaction");
  }
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

  let created: typeof bounties.$inferSelect;
  try {
    const [row] = await db
      .insert(bounties)
      .values({
        recruiterUserId: session.user.id,
        recruiterWallet,
        jobDescriptionId: jd.id,
        title: parsed.title,
        company: parsed.company,
        companyLogoUrl: parsed.companyLogoUrl?.trim() || null,
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
    created = row;
  } catch (err) {
    rethrowReadableError(err, "Failed to save confirmed bounty record");
  }

  return successResponse({
    ...created,
    txUrl: getExplorerTxUrl(parsed.txSignature),
    escrowUrl: getExplorerAddressUrl(escrowRes.escrowPda),
  });
});

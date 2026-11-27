import { PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  agentRuns,
  evaluations,
  jobDescriptions,
  reports,
  userProfiles,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import {
  BadRequestError,
  createApiHandler,
  ForbiddenError,
  NotFoundError,
  successResponse,
} from "@/lib/shared";
import {
  agentScoresToTuple,
  computeCanonicalHashFromReportRecord,
  confirmSubmittedSignature,
  deriveEvaluationPda,
  deriveProfilePda,
  extractVerifiedSkills,
  fetchOnChainConfig,
  fetchOnChainEvaluation,
  fetchOnChainProfile,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getScoreTierLabel,
  prepareAnchorEvaluationTx,
  prepareDefenseUpdateTx,
} from "@/lib/solana";

const PrepareAnchorSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  action: z.enum(["auto", "anchor", "defense_sync"]).default("auto"),
});

const ConfirmAnchorSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  txSignature: z.string().min(32).max(128),
});

async function loadEvaluationSolanaContext(evaluationId: string, userId: string) {
  const [evalRow] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (!evalRow) {
    throw new NotFoundError("Evaluation not found");
  }
  if (evalRow.ownerUserId !== userId) {
    throw new ForbiddenError("You do not have permission to access this evaluation");
  }

  const [jdRow] = await db
    .select({
      id: jobDescriptions.id,
      title: jobDescriptions.title,
      company: jobDescriptions.company,
    })
    .from(jobDescriptions)
    .where(eq(jobDescriptions.id, evalRow.jobDescriptionId))
    .limit(1);

  const [reportRow] = await db
    .select()
    .from(reports)
    .where(eq(reports.evaluationId, evaluationId))
    .limit(1);

  const runs = await db
    .select({
      agentRole: agentRuns.agentRole,
      scoreContribution: agentRuns.scoreContribution,
      modelVersion: agentRuns.modelVersion,
    })
    .from(agentRuns)
    .where(eq(agentRuns.evaluationId, evaluationId));

  const [profileRow] = await db
    .select({
      walletAddress: userProfiles.walletAddress,
      profilePdaAddress: userProfiles.profilePdaAddress,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const revisions = Array.isArray(
    (evalRow.workflowState as Record<string, unknown> | null)?.defenseRevisions
  )
    ? ((evalRow.workflowState as Record<string, unknown>).defenseRevisions as unknown[])
    : [];

  const modelVersion =
    evalRow.modelVersion ||
    runs.find((r) => r.modelVersion)?.modelVersion ||
    "gemini-2.5-flash";

  let canonicalHashHex = evalRow.canonicalReportHash || reportRow?.canonicalReportHash || null;
  let agentScores = {
    hr_recruiter: 0,
    technical_interviewer: 0,
    ats_scanner: 0,
    hiring_manager: 0,
    career_strategist: 0,
    red_flag_analyst: 0,
  };
  let verifiedSkills: string[] = [];

  if (reportRow?.structuredReport) {
    const rawSr = reportRow.structuredReport as Record<string, unknown>;
    const computed = await computeCanonicalHashFromReportRecord({
      evaluationId: evalRow.id,
      jobDescriptionId: evalRow.jobDescriptionId,
      structuredReport: rawSr,
      agentRuns: runs,
      overrideScore: evalRow.overallScore ?? undefined,
      overrideVerdict: evalRow.verdict ?? undefined,
      modelVersion,
      defenseRevisionsCount: revisions.length,
    });
    canonicalHashHex = computed.hashHex;
    agentScores = computed.agentScores;

    const matched = Array.isArray(
      (rawSr.atsSummary as { matched?: string[] } | undefined)?.matched
    )
      ? ((rawSr.atsSummary as { matched: string[] }).matched)
      : [];
    verifiedSkills = extractVerifiedSkills(matched);
  }

  return {
    evalRow,
    jdRow,
    reportRow,
    profileRow,
    modelVersion,
    canonicalHashHex,
    agentScores,
    defenseRevisionsCount: revisions.length,
    verifiedSkills,
  };
}

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const url = new URL(req.url);
    const walletOverride = url.searchParams.get("wallet")?.trim() || null;

    const ctx = await loadEvaluationSolanaContext(id, session.user.id);
    const targetWallet =
      walletOverride ||
      ctx.evalRow.candidateWallet ||
      ctx.profileRow?.walletAddress ||
      null;

    let onChainConfig = null;
    let onChainEval = null;
    let onChainProfile = null;
    let evalPdaAddress = ctx.evalRow.evalPdaAddress ?? null;
    let profilePdaAddress = ctx.profileRow?.profilePdaAddress ?? null;
    let rpcError: string | null = null;

    try {
      const [cfgRes, evalRes, profRes] = await Promise.all([
        fetchOnChainConfig(),
        targetWallet
          ? fetchOnChainEvaluation(targetWallet, ctx.evalRow.id)
          : Promise.resolve(null),
        targetWallet
          ? fetchOnChainProfile(targetWallet)
          : Promise.resolve(null),
      ]);

      onChainConfig = cfgRes;
      if (evalRes) {
        evalPdaAddress = evalRes.evalPda;
        onChainEval = evalRes.record;
      }
      if (profRes) {
        profilePdaAddress = profRes.profilePda;
        onChainProfile = profRes.profile;
      }
    } catch (err) {
      rpcError = err instanceof Error ? err.message : "Failed to reach Solana Devnet RPC";
    }

    const effectiveScore = ctx.evalRow.overallScore ?? 0;
    const needsDefenseSync = Boolean(
      onChainEval &&
        ctx.canonicalHashHex &&
        (onChainEval.currentReportHash !== ctx.canonicalHashHex ||
          onChainEval.compositeScore !== Math.round(effectiveScore))
    );

    return successResponse({
      evaluationId: ctx.evalRow.id,
      jobDescriptionId: ctx.evalRow.jobDescriptionId,
      status: ctx.evalRow.status,
      overallScore: effectiveScore,
      scoreTier: getScoreTierLabel(effectiveScore),
      sbtEligible: effectiveScore >= 85,
      verdict: ctx.evalRow.verdict,
      roleTitle: ctx.jdRow?.title || "Target Role",
      targetCompany: ctx.jdRow?.company || null,
      modelVersion: ctx.modelVersion,
      defenseRevisionsCount: ctx.defenseRevisionsCount,
      canonicalReportHash: ctx.canonicalHashHex,
      agentScores: ctx.agentScores,
      verifiedSkills: ctx.verifiedSkills,
      linkedWallet: ctx.profileRow?.walletAddress ?? null,
      candidateWallet: targetWallet,
      profilePdaAddress,
      evalPdaAddress,
      evalTxSignature: ctx.evalRow.evalTxSignature ?? null,
      evalTxUrl: ctx.evalRow.evalTxSignature
        ? getExplorerTxUrl(ctx.evalRow.evalTxSignature)
        : null,
      evalPdaUrl: evalPdaAddress ? getExplorerAddressUrl(evalPdaAddress) : null,
      sbtMintAddress: onChainEval?.sbtMinted
        ? onChainEval.sbtMint
        : ctx.evalRow.sbtMintAddress ?? null,
      sbtTxSignature: ctx.evalRow.sbtTxSignature ?? null,
      sbtTxUrl: ctx.evalRow.sbtTxSignature
        ? getExplorerTxUrl(ctx.evalRow.sbtTxSignature)
        : null,
      sbtMintUrl:
        onChainEval?.sbtMinted || ctx.evalRow.sbtMintAddress
          ? getExplorerAddressUrl(onChainEval?.sbtMinted ? onChainEval.sbtMint : ctx.evalRow.sbtMintAddress!)
          : null,
      programConfigInitialized: onChainConfig?.initialized ?? false,
      needsDefenseSync,
      onChainEval,
      onChainProfile,
      rpcError,
    });
  }
);

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = PrepareAnchorSchema.parse(body);

    let candidateWallet: string;
    try {
      candidateWallet = new PublicKey(parsed.walletAddress).toBase58();
    } catch {
      throw new BadRequestError("Invalid candidate Solana wallet address");
    }

    const ctx = await loadEvaluationSolanaContext(id, session.user.id);
    if (ctx.evalRow.status !== "completed" || !ctx.canonicalHashHex) {
      throw new BadRequestError(
        "Evaluation must be completed before anchoring proof on-chain."
      );
    }

    const existingOnChain = await fetchOnChainEvaluation(candidateWallet, id);
    const shouldUpdateDefense =
      parsed.action === "defense_sync" ||
      (parsed.action === "auto" && existingOnChain.record !== null);

    if (shouldUpdateDefense) {
      if (!existingOnChain.record) {
        throw new BadRequestError(
          "Anchor the initial evaluation on-chain before syncing Defense updates."
        );
      }
      const prepared = await prepareDefenseUpdateTx({
        candidateWallet,
        evalId: ctx.evalRow.id,
        newReportHashHex: ctx.canonicalHashHex,
        newCompositeScore: Math.round(ctx.evalRow.overallScore ?? 0),
      });
      return successResponse({
        mode: "defense_sync" as const,
        canonicalReportHash: ctx.canonicalHashHex,
        ...prepared,
      });
    }

    const prepared = await prepareAnchorEvaluationTx({
      candidateWallet,
      evalId: ctx.evalRow.id,
      jobId: ctx.evalRow.jobDescriptionId,
      reportHashHex: ctx.canonicalHashHex,
      compositeScore: Math.round(ctx.evalRow.overallScore ?? 0),
      agentScores: agentScoresToTuple(ctx.agentScores),
      modelVersion: ctx.modelVersion,
      roleTitle: ctx.jdRow?.title || "Candidate Role",
      verifiedSkills: ctx.verifiedSkills,
    });

    return successResponse({
      mode: "anchor" as const,
      canonicalReportHash: ctx.canonicalHashHex,
      ...prepared,
    });
  }
);

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = ConfirmAnchorSchema.parse(body);

    let candidatePubkey: PublicKey;
    try {
      candidatePubkey = new PublicKey(parsed.walletAddress);
    } catch {
      throw new BadRequestError("Invalid Solana wallet address");
    }
    const candidateWallet = candidatePubkey.toBase58();

    const ctx = await loadEvaluationSolanaContext(id, session.user.id);
    await confirmSubmittedSignature(parsed.txSignature);

    const [evalRes, profRes] = await Promise.all([
      fetchOnChainEvaluation(candidateWallet, ctx.evalRow.id),
      fetchOnChainProfile(candidateWallet),
    ]);

    if (!evalRes.record) {
      throw new BadRequestError(
        "Transaction confirmed, but EvaluationRecord PDA was not found on-chain for this wallet."
      );
    }

    const [, ] = deriveEvaluationPda(candidatePubkey, ctx.evalRow.id);
    const [profilePda] = deriveProfilePda(candidatePubkey);

    await db
      .update(evaluations)
      .set({
        candidateWallet,
        evalPdaAddress: evalRes.evalPda,
        evalTxSignature: parsed.txSignature,
        canonicalReportHash: evalRes.record.currentReportHash,
        ...(evalRes.record.sbtMinted ? { sbtMintAddress: evalRes.record.sbtMint } : {}),
        updatedAt: new Date(),
      })
      .where(eq(evaluations.id, ctx.evalRow.id));

    if (
      profRes.profile &&
      (!ctx.profileRow?.walletAddress || ctx.profileRow.walletAddress === candidateWallet)
    ) {
      if (ctx.profileRow) {
        await db
          .update(userProfiles)
          .set({
            walletAddress: candidateWallet,
            profilePdaAddress: profilePda.toBase58(),
            profileTxSignature: parsed.txSignature,
            walletVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(userProfiles.userId, session.user.id));
      }
    }

    return successResponse({
      confirmed: true,
      txSignature: parsed.txSignature,
      explorerTxUrl: getExplorerTxUrl(parsed.txSignature),
      evalPdaAddress: evalRes.evalPda,
      profilePdaAddress: profilePda.toBase58(),
      onChainEval: evalRes.record,
      onChainProfile: profRes.profile,
    });
  }
);

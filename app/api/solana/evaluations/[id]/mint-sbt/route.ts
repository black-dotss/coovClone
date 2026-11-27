import { PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { evaluations, jobDescriptions } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import {
  BadRequestError,
  createApiHandler,
  ForbiddenError,
  NotFoundError,
  successResponse,
} from "@/lib/shared";
import {
  confirmSubmittedSignature,
  fetchOnChainEvaluation,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getScoreTierLabel,
  prepareMintCredentialTx,
} from "@/lib/solana";

const PrepareSbtSchema = z.object({
  walletAddress: z.string().min(32).max(64),
});

const ConfirmSbtSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  txSignature: z.string().min(32).max(128),
  sbtMintAddress: z.string().min(32).max(64),
});

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = PrepareSbtSchema.parse(body);

    let candidateWallet: string;
    try {
      candidateWallet = new PublicKey(parsed.walletAddress).toBase58();
    } catch {
      throw new BadRequestError("Invalid Solana wallet address");
    }

    const [evalRow] = await db
      .select()
      .from(evaluations)
      .where(eq(evaluations.id, id))
      .limit(1);

    if (!evalRow) {
      throw new NotFoundError("Evaluation not found");
    }
    if (evalRow.ownerUserId !== session.user.id) {
      throw new ForbiddenError("You do not have permission to mint for this evaluation");
    }
    if (evalRow.status !== "completed" || (evalRow.overallScore ?? 0) < 85) {
      throw new BadRequestError(
        "Evaluation score must be at least 85/100 to mint a Soulbound Credential."
      );
    }

    const [jdRow] = await db
      .select({ title: jobDescriptions.title })
      .from(jobDescriptions)
      .where(eq(jobDescriptions.id, evalRow.jobDescriptionId))
      .limit(1);

    const onChainEval = await fetchOnChainEvaluation(candidateWallet, id);
    if (!onChainEval.record) {
      throw new BadRequestError(
        "Anchor your evaluation on-chain first before minting the Soulbound Credential."
      );
    }

    const roleTitle = (jdRow?.title || "Verified Technical Role").trim();
    const scoreTier = getScoreTierLabel(onChainEval.record.compositeScore);
    const origin = new URL(req.url).origin;

    const prepared = await prepareMintCredentialTx({
      candidateWallet,
      evalId: evalRow.id,
      name: `COOV · ${roleTitle}`,
      symbol: "COOV-SBT",
      uri: `${origin}/evaluations/${evalRow.id}/report`,
      roleTitle,
      scoreTier,
    });

    return successResponse(prepared);
  }
);

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = ConfirmSbtSchema.parse(body);

    let candidateWallet: string;
    try {
      candidateWallet = new PublicKey(parsed.walletAddress).toBase58();
    } catch {
      throw new BadRequestError("Invalid Solana wallet address");
    }

    const [evalRow] = await db
      .select({ id: evaluations.id, ownerUserId: evaluations.ownerUserId })
      .from(evaluations)
      .where(eq(evaluations.id, id))
      .limit(1);

    if (!evalRow) {
      throw new NotFoundError("Evaluation not found");
    }
    if (evalRow.ownerUserId !== session.user.id) {
      throw new ForbiddenError("You do not own this evaluation");
    }

    await confirmSubmittedSignature(parsed.txSignature);
    const onChain = await fetchOnChainEvaluation(candidateWallet, id);
    if (!onChain.record?.sbtMinted) {
      throw new BadRequestError(
        "Transaction confirmed, but on-chain Soulbound Credential status is not finalized."
      );
    }

    const resolvedMint = onChain.record.sbtMint || parsed.sbtMintAddress;
    await db
      .update(evaluations)
      .set({
        sbtMintAddress: resolvedMint,
        sbtTxSignature: parsed.txSignature,
        updatedAt: new Date(),
      })
      .where(eq(evaluations.id, evalRow.id));

    return successResponse({
      confirmed: true,
      sbtMintAddress: resolvedMint,
      sbtTxSignature: parsed.txSignature,
      sbtMintUrl: getExplorerAddressUrl(resolvedMint),
      sbtTxUrl: getExplorerTxUrl(parsed.txSignature),
      onChainEval: onChain.record,
    });
  }
);

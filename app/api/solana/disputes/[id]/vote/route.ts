import { PublicKey } from "@solana/web3.js";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  auditEvents,
  bounties,
  bountyClaims,
  bountyDisputes,
  bountyRestrictions,
  bountySubmissions,
} from "@/lib/db/schema";
import {
  BadRequestError,
  createApiHandler,
  ForbiddenError,
  NotFoundError,
  successResponse,
} from "@/lib/shared";
import {
  computeScoutSplitMicros,
  confirmSubmittedSignature,
  fetchOnChainClaimReceipt,
  fetchOnChainConvictionStake,
  fetchOnChainDisputeTicket,
  fetchOnChainEscrow,
  getExplorerTxUrl,
  prepareCastJuryVoteTx,
} from "@/lib/solana";

const PrepareVoteSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  approveCandidate: z.boolean(),
});

const ConfirmVoteSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  approveCandidate: z.boolean(),
  txSignature: z.string().min(32).max(128),
});

async function loadDisputeWithBounty(disputeId: string) {
  const [row] = await db
    .select({
      dispute: bountyDisputes,
      bounty: bounties,
      submission: bountySubmissions,
    })
    .from(bountyDisputes)
    .innerJoin(bounties, eq(bountyDisputes.bountyId, bounties.id))
    .innerJoin(bountySubmissions, eq(bountyDisputes.submissionId, bountySubmissions.id))
    .where(eq(bountyDisputes.id, disputeId))
    .limit(1);

  if (!row) {
    throw new NotFoundError("Dispute Jury ticket not found.");
  }
  return row;
}

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id: disputeId } = await context.params;
    const body = await req.json();
    const parsed = PrepareVoteSchema.parse(body);

    let jurorWallet: string;
    try {
      jurorWallet = new PublicKey(parsed.walletAddress).toBase58();
    } catch {
      throw new BadRequestError("Invalid juror Solana wallet address.");
    }

    const { dispute, bounty } = await loadDisputeWithBounty(disputeId);

    if (dispute.candidateUserId === session.user.id || dispute.candidateWallet === jurorWallet) {
      throw new ForbiddenError("Candidates cannot vote on their own Jury Dispute.");
    }
    if (bounty.recruiterUserId === session.user.id || bounty.recruiterWallet === jurorWallet) {
      throw new ForbiddenError("Bounty creators cannot vote on their own bounty disputes.");
    }
    if (dispute.status !== "open") {
      throw new BadRequestError(`This Dispute Jury ticket is already resolved (${dispute.status}).`);
    }

    const prepared = await prepareCastJuryVoteTx({
      jurorWallet,
      candidateWallet: dispute.candidateWallet,
      jobId: bounty.jobDescriptionId,
      approveCandidate: parsed.approveCandidate,
    });

    return successResponse(prepared);
  }
);

export const PATCH = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id: disputeId } = await context.params;
    const body = await req.json();
    const parsed = ConfirmVoteSchema.parse(body);

    let jurorWallet: string;
    try {
      jurorWallet = new PublicKey(parsed.walletAddress).toBase58();
    } catch {
      throw new BadRequestError("Invalid juror Solana wallet address.");
    }

    const { dispute, bounty, submission } = await loadDisputeWithBounty(disputeId);

    await confirmSubmittedSignature(parsed.txSignature);
    const [ticketRes, escrowRes, stakeRes] = await Promise.all([
      fetchOnChainDisputeTicket(bounty.jobDescriptionId, dispute.candidateWallet),
      fetchOnChainEscrow(bounty.jobDescriptionId),
      fetchOnChainConvictionStake(bounty.jobDescriptionId, dispute.candidateWallet),
    ]);

    if (!ticketRes.dispute) {
      throw new BadRequestError(
        "Transaction confirmed, but DisputeTicket PDA could not be read on-chain."
      );
    }

    const onChainTicket = ticketRes.dispute;
    const existingVotes = Array.isArray(dispute.jurorVotes) ? dispute.jurorVotes : [];
    const updatedVotes = existingVotes.some((v) => v.wallet === jurorWallet)
      ? existingVotes
      : [
          ...existingVotes,
          {
            wallet: jurorWallet,
            approveCandidate: parsed.approveCandidate,
            txSignature: parsed.txSignature,
            votedAt: new Date().toISOString(),
          },
        ];

    const now = new Date();
    const isResolved = onChainTicket.status !== "open";

    const [updatedDispute] = await db
      .update(bountyDisputes)
      .set({
        votesForCandidate: onChainTicket.votesForCandidate,
        votesForRecruiter: onChainTicket.votesForRecruiter,
        jurorWallets: onChainTicket.jurors,
        jurorVotes: updatedVotes,
        status: onChainTicket.status,
        ...(isResolved
          ? {
              resolveTxSignature: parsed.txSignature,
              resolvedAt: now,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(bountyDisputes.id, dispute.id))
      .returning();

    let totalPaidUsdc = 0;
    let bonusPaidUsdc = 0;
    let slashedAmountUsdc = 0;

    if (onChainTicket.status === "resolved_candidate") {
      const claimRes = await fetchOnChainClaimReceipt(
        bounty.jobDescriptionId,
        dispute.candidateWallet
      ).catch(() => ({ claimReceiptPda: "", claim: null }));

      const paidMicros = BigInt(
        claimRes.claim?.amountPaidMicros ?? bounty.rewardPerWinnerMicros
      );
      const referrerWallet = stakeRes.stake?.referrer ?? submission.referrerWallet ?? null;
      const { candidateRewardMicros, scoutCutMicros } = computeScoutSplitMicros(
        bounty.rewardPerWinnerMicros,
        Boolean(referrerWallet)
      );
      const stakeMicros = BigInt(
        stakeRes.stake?.amountStakedMicros ?? submission.stakeAmountMicros ?? "0"
      );
      const bonusMicros =
        paidMicros > candidateRewardMicros + stakeMicros
          ? paidMicros - candidateRewardMicros - stakeMicros
          : BigInt(0);

      totalPaidUsdc = Number(paidMicros) / 1_000_000;
      bonusPaidUsdc = Number(bonusMicros) / 1_000_000;

      await db
        .update(bountySubmissions)
        .set({
          reviewStatus: "claimed",
          stakeStatus: stakeRes.stake?.status ?? "approved",
          payoutTxSignature: parsed.txSignature,
          bonusPaidMicros: bonusMicros.toString(),
          referrerWallet,
          scoutCutMicros: scoutCutMicros.toString(),
          recruiterNotes: `${dispute.rejectionReason ?? "Rejected"} [Overridden 2/3 by Peer Dispute Jury]`,
          updatedAt: now,
        })
        .where(eq(bountySubmissions.id, submission.id));

      await db
        .insert(bountyClaims)
        .values({
          bountyId: bounty.id,
          candidateUserId: dispute.candidateUserId,
          candidateWallet: dispute.candidateWallet,
          evaluationId: dispute.evaluationId,
          claimReceiptPda: claimRes.claimReceiptPda,
          claimTxSignature: parsed.txSignature,
          amountMicros: paidMicros.toString(),
          referrerWallet,
          scoutCutMicros: scoutCutMicros.toString(),
        })
        .onConflictDoNothing();

      // Clear recruiter rejection restriction after Peer Jury Override wins
      await db
        .delete(bountyRestrictions)
        .where(
          and(
            eq(bountyRestrictions.bountyId, bounty.id),
            eq(bountyRestrictions.reason, "recruiter_rejected"),
            or(
              eq(bountyRestrictions.userId, dispute.candidateUserId),
              eq(bountyRestrictions.walletAddress, dispute.candidateWallet)
            )
          )
        );

      const nextClaims = escrowRes.escrow?.claimsCount ?? bounty.claimsCount + 1;
      const nextOpen =
        typeof escrowRes.escrow?.openDisputesCount === "number"
          ? escrowRes.escrow.openDisputesCount
          : Math.max(0, (bounty.openDisputesCount ?? 1) - 1);
      await db
        .update(bounties)
        .set({
          claimsCount: nextClaims,
          openDisputesCount: nextOpen,
          ...(escrowRes.escrow?.slashedPoolAmountMicros
            ? { slashedPoolMicros: escrowRes.escrow.slashedPoolAmountMicros }
            : {}),
          status:
            escrowRes.escrow?.isClosed || nextClaims >= bounty.maxWinners
              ? "filled"
              : "active",
          updatedAt: now,
        })
        .where(eq(bounties.id, bounty.id));
    } else if (onChainTicket.status === "resolved_recruiter") {
      slashedAmountUsdc = stakeRes.stake
        ? Number(stakeRes.stake.amountStakedMicros) / 1_000_000
        : 0;

      await db
        .update(bountySubmissions)
        .set({
          stakeStatus: stakeRes.stake?.status ?? "slashed",
          slashTxSignature: parsed.txSignature,
          updatedAt: now,
        })
        .where(eq(bountySubmissions.id, submission.id));

      const nextOpen =
        typeof escrowRes.escrow?.openDisputesCount === "number"
          ? escrowRes.escrow.openDisputesCount
          : Math.max(0, (bounty.openDisputesCount ?? 1) - 1);
      await db
        .update(bounties)
        .set({
          openDisputesCount: nextOpen,
          ...(escrowRes.escrow?.slashedPoolAmountMicros
            ? { slashedPoolMicros: escrowRes.escrow.slashedPoolAmountMicros }
            : {}),
          updatedAt: now,
        })
        .where(eq(bounties.id, bounty.id));
    }

    try {
      await db.insert(auditEvents).values({
        userId: session.user.id,
        action:
          onChainTicket.status === "resolved_candidate"
            ? "bounty.dispute_resolved_candidate"
            : onChainTicket.status === "resolved_recruiter"
            ? "bounty.dispute_resolved_recruiter"
            : "bounty.dispute_vote_cast",
        targetType: "bounty_dispute",
        targetId: dispute.id,
        metadata: {
          bountyId: bounty.id,
          jurorWallet,
          approveCandidate: parsed.approveCandidate,
          votesForCandidate: onChainTicket.votesForCandidate,
          votesForRecruiter: onChainTicket.votesForRecruiter,
          txSignature: parsed.txSignature,
        },
      });
    } catch {}

    return successResponse({
      confirmed: true,
      dispute: updatedDispute,
      status: onChainTicket.status,
      votesForCandidate: onChainTicket.votesForCandidate,
      votesForRecruiter: onChainTicket.votesForRecruiter,
      totalPaidUsdc,
      bonusPaidUsdc,
      slashedAmountUsdc,
      txSignature: parsed.txSignature,
      txUrl: getExplorerTxUrl(parsed.txSignature),
    });
  }
);

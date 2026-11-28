import { PublicKey } from "@solana/web3.js";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bounties,
  bountyClaims,
  bountySubmissions,
  userNotifications,
  userProfiles,
} from "@/lib/db/schema";
import { computeScoutSplitMicros } from "@/lib/solana/codec";

export interface CreateUserNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  href?: string | null;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

function formatUsdcLabel(micros: string | bigint | number | null | undefined): string {
  if (micros === null || micros === undefined) return "0.00";
  try {
    return (Number(BigInt(micros)) / 1_000_000).toFixed(2);
  } catch {
    return "0.00";
  }
}

export async function createNotification(input: CreateUserNotificationInput): Promise<void> {
  if (!input.userId) return;
  try {
    await db
      .insert(userNotifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 140),
        message: input.message.slice(0, 500),
        href: input.href ?? null,
        dedupeKey: input.dedupeKey ?? null,
        metadata: input.metadata ?? {},
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      })
      .onConflictDoNothing();
  } catch {
    // Non-fatal in case DB mock lacks user_notifications or transient insert error
  }
}

export async function resolveUserIdForWallet(
  walletAddress: string | null | undefined
): Promise<string | null> {
  const trimmed = walletAddress?.trim();
  if (!trimmed) return null;
  try {
    const [profile] = await db
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(eq(userProfiles.walletAddress, trimmed))
      .limit(1);
    return profile?.userId ?? null;
  } catch {
    return null;
  }
}

export async function notifyScoutReferralEntered(params: {
  bountyId: string;
  bountyTitle: string;
  company: string;
  rewardPerWinnerMicros: string;
  candidateUserId: string;
  referrerWallet: string | null | undefined;
  evaluationId: string;
  createdAt?: Date;
}) {
  const scoutUserId = await resolveUserIdForWallet(params.referrerWallet);
  if (!scoutUserId || scoutUserId === params.candidateUserId) return;

  const { scoutCutMicros } = computeScoutSplitMicros(params.rewardPerWinnerMicros, true);
  const scoutUsdc = formatUsdcLabel(scoutCutMicros);

  await createNotification({
    userId: scoutUserId,
    type: "scout_referral_entered",
    title: `Friend entered ${params.bountyTitle}`,
    message: `Someone used your Scout share link for ${params.bountyTitle} (${params.company}). You earn +${scoutUsdc} USDC (10% cut) if they win.`,
    href: `/bounties/${params.bountyId}`,
    dedupeKey: `scout-enter:${params.bountyId}:${params.evaluationId}`,
    metadata: {
      bountyId: params.bountyId,
      evaluationId: params.evaluationId,
      referrerWallet: params.referrerWallet,
    },
    createdAt: params.createdAt,
  });
}

export async function notifyBountyQualifiedAndPending(params: {
  bountyId: string;
  bountyTitle: string;
  company: string;
  rewardPerWinnerMicros: string;
  recruiterUserId: string;
  candidateUserId: string;
  score: number;
  referrerWallet: string | null | undefined;
  evaluationId: string;
}) {
  const { scoutCutMicros } = computeScoutSplitMicros(
    params.rewardPerWinnerMicros,
    Boolean(params.referrerWallet)
  );
  const scoutUsdc = formatUsdcLabel(scoutCutMicros);

  const tasks: Promise<void>[] = [];

  if (params.referrerWallet) {
    tasks.push(
      (async () => {
        const scoutUserId = await resolveUserIdForWallet(params.referrerWallet);
        if (!scoutUserId || scoutUserId === params.candidateUserId) return;
        await createNotification({
          userId: scoutUserId,
          type: "scout_referral_qualified",
          title: `Friend qualified (${params.score}/100) · ${params.bountyTitle}`,
          message: `Your referred candidate passed (${params.score}/100) on ${params.bountyTitle} (${params.company}). Awaiting publisher approval for your +${scoutUsdc} USDC Scout cut.`,
          href: `/bounties/${params.bountyId}`,
          dedupeKey: `scout-qualified:${params.bountyId}:${params.evaluationId}`,
          metadata: {
            bountyId: params.bountyId,
            evaluationId: params.evaluationId,
            score: params.score,
          },
        });
      })()
    );
  }

  if (params.recruiterUserId && params.recruiterUserId !== params.candidateUserId) {
    tasks.push(
      createNotification({
        userId: params.recruiterUserId,
        type: "bounty_submission_pending",
        title: `New qualified applicant (${params.score}/100)`,
        message: `A candidate scored ${params.score}/100 on ${params.bountyTitle} (${params.company}) and reserved a 24h review slot.`,
        href: `/bounties/${params.bountyId}`,
        dedupeKey: `recruiter-pending:${params.bountyId}:${params.evaluationId}`,
        metadata: {
          bountyId: params.bountyId,
          evaluationId: params.evaluationId,
          score: params.score,
        },
      })
    );
  }

  await Promise.all(tasks);
}

export async function notifyBountyWinnerSettled(params: {
  bountyId: string;
  bountyTitle: string;
  company: string;
  rewardPerWinnerMicros: string;
  candidateUserId: string;
  referrerWallet: string | null | undefined;
  candidatePaidMicros?: string | null;
  scoutPaidMicros?: string | null;
  evaluationId: string;
  isSettledOnChain: boolean;
  createdAt?: Date;
}) {
  const { scoutCutMicros } = computeScoutSplitMicros(
    params.rewardPerWinnerMicros,
    Boolean(params.referrerWallet)
  );
  const resolvedScoutMicros = params.scoutPaidMicros ?? scoutCutMicros.toString();
  const scoutUsdc = formatUsdcLabel(resolvedScoutMicros);
  const candUsdc = formatUsdcLabel(params.candidatePaidMicros ?? params.rewardPerWinnerMicros);

  const tasks: Promise<void>[] = [
    createNotification({
      userId: params.candidateUserId,
      type: "bounty_submission_approved",
      title: params.isSettledOnChain
        ? `You won ${params.bountyTitle}!`
        : `Approved on ${params.bountyTitle}`,
      message: params.isSettledOnChain
        ? `Your payout (${candUsdc} USDC) settled on Solana for ${params.bountyTitle} (${params.company}).`
        : `The publisher approved your submission for ${params.bountyTitle} (${params.company}). Claim your ${candUsdc} USDC payout now.`,
      href: `/bounties/${params.bountyId}`,
      dedupeKey: `winner:${params.bountyId}:${params.evaluationId}:${params.isSettledOnChain ? "paid" : "approved"}`,
      metadata: {
        bountyId: params.bountyId,
        evaluationId: params.evaluationId,
      },
      createdAt: params.createdAt,
    }),
  ];

  if (params.referrerWallet) {
    tasks.push(
      (async () => {
        const scoutUserId = await resolveUserIdForWallet(params.referrerWallet);
        if (!scoutUserId || scoutUserId === params.candidateUserId) return;
        await createNotification({
          userId: scoutUserId,
          type: "scout_referral_won",
          title: `Your friend won ${params.bountyTitle}!`,
          message: params.isSettledOnChain
            ? `Your referred friend won ${params.bountyTitle} (${params.company})! You earned +${scoutUsdc} USDC (10% Scout Cut) on Solana.`
            : `Your referred friend was approved on ${params.bountyTitle} (${params.company})! +${scoutUsdc} USDC Scout Cut unlocked.`,
          href: `/bounties/${params.bountyId}`,
          dedupeKey: `scout-win:${params.bountyId}:${params.evaluationId}:${params.isSettledOnChain ? "paid" : "approved"}`,
          metadata: {
            bountyId: params.bountyId,
            evaluationId: params.evaluationId,
            scoutUsdc,
          },
          createdAt: params.createdAt,
        });
      })()
    );
  }

  await Promise.all(tasks);
}

export async function notifyBountyRejected(params: {
  bountyId: string;
  bountyTitle: string;
  company: string;
  candidateUserId: string;
  evaluationId: string;
  reason?: string | null;
}) {
  await createNotification({
    userId: params.candidateUserId,
    type: "bounty_submission_rejected",
    title: `Review decision on ${params.bountyTitle}`,
    message: params.reason
      ? `${params.bountyTitle} (${params.company}): ${params.reason}`
      : `Your submission for ${params.bountyTitle} (${params.company}) was rejected by the publisher.`,
    href: `/bounties/${params.bountyId}`,
    dedupeKey: `rejected:${params.bountyId}:${params.evaluationId}`,
    metadata: {
      bountyId: params.bountyId,
      evaluationId: params.evaluationId,
    },
  });
}

/**
 * Ensures notifications exist for historical or live Scout referrals and bounty outcomes
 * matching either the user's linked profile wallet or their currently connected Solana wallet.
 */
export async function syncWalletAndBountyNotificationsForUser(params: {
  userId: string;
  connectedWallet?: string | null;
}) {
  try {
    let validConnectedWallet: string | null = null;
    if (params.connectedWallet?.trim()) {
      try {
        validConnectedWallet = new PublicKey(params.connectedWallet.trim()).toBase58();
      } catch {
        validConnectedWallet = null;
      }
    }

    const [profile] = await db
      .select({ walletAddress: userProfiles.walletAddress })
      .from(userProfiles)
      .where(eq(userProfiles.userId, params.userId))
      .limit(1);

    const candidateWallets = Array.from(
      new Set([profile?.walletAddress, validConnectedWallet].filter((w): w is string => Boolean(w)))
    );

    const [claimRows, scoutSubRows, recruiterPendingRows] = await Promise.all([
      candidateWallets.length > 0
        ? db
            .select({
              claim: bountyClaims,
              bounty: bounties,
            })
            .from(bountyClaims)
            .innerJoin(bounties, eq(bountyClaims.bountyId, bounties.id))
            .where(
              or(
                inArray(bountyClaims.referrerWallet, candidateWallets),
                eq(bountyClaims.candidateUserId, params.userId)
              )
            )
            .orderBy(desc(bountyClaims.createdAt))
            .limit(20)
        : db
            .select({
              claim: bountyClaims,
              bounty: bounties,
            })
            .from(bountyClaims)
            .innerJoin(bounties, eq(bountyClaims.bountyId, bounties.id))
            .where(eq(bountyClaims.candidateUserId, params.userId))
            .orderBy(desc(bountyClaims.createdAt))
            .limit(20),
      candidateWallets.length > 0
        ? db
            .select({
              submission: bountySubmissions,
              bounty: bounties,
            })
            .from(bountySubmissions)
            .innerJoin(bounties, eq(bountySubmissions.bountyId, bounties.id))
            .where(inArray(bountySubmissions.referrerWallet, candidateWallets))
            .orderBy(desc(bountySubmissions.createdAt))
            .limit(20)
        : Promise.resolve([]),
      db
        .select({
          submission: bountySubmissions,
          bounty: bounties,
        })
        .from(bountySubmissions)
        .innerJoin(bounties, eq(bountySubmissions.bountyId, bounties.id))
        .where(
          and(
            eq(bounties.recruiterUserId, params.userId),
            eq(bountySubmissions.reviewStatus, "pending_review")
          )
        )
        .orderBy(desc(bountySubmissions.createdAt))
        .limit(15),
    ]);

    const inserts: Promise<void>[] = [];

    for (const row of claimRows) {
      const { claim, bounty } = row;
      const isScout =
        Boolean(claim.referrerWallet) &&
        candidateWallets.includes(claim.referrerWallet!) &&
        claim.candidateUserId !== params.userId;

      if (isScout) {
        const { scoutCutMicros } = computeScoutSplitMicros(bounty.rewardPerWinnerMicros, true);
        const scoutUsdc = formatUsdcLabel(claim.scoutCutMicros ?? scoutCutMicros.toString());
        inserts.push(
          createNotification({
            userId: params.userId,
            type: "scout_referral_won",
            title: `Your friend won ${bounty.title}!`,
            message: `Your referred friend won ${bounty.title} (${bounty.company})! You earned +${scoutUsdc} USDC (10% Scout Cut).`,
            href: `/bounties/${bounty.id}`,
            dedupeKey: `scout-win:${bounty.id}:${claim.evaluationId}:paid`,
            createdAt: claim.createdAt,
          })
        );
      }

      if (claim.candidateUserId === params.userId) {
        const paidUsdc = formatUsdcLabel(claim.amountMicros);
        inserts.push(
          createNotification({
            userId: params.userId,
            type: "bounty_submission_approved",
            title: `You won ${bounty.title}!`,
            message: `Payout of ${paidUsdc} USDC settled on Solana for ${bounty.title} (${bounty.company}).`,
            href: `/bounties/${bounty.id}`,
            dedupeKey: `winner:${bounty.id}:${claim.evaluationId}:paid`,
            createdAt: claim.createdAt,
          })
        );
      }
    }

    for (const row of scoutSubRows) {
      const { submission, bounty } = row;
      if (submission.candidateUserId === params.userId) continue;

      const { scoutCutMicros } = computeScoutSplitMicros(bounty.rewardPerWinnerMicros, true);
      const scoutUsdc = formatUsdcLabel(submission.scoutCutMicros ?? scoutCutMicros.toString());

      if (submission.reviewStatus === "claimed" || submission.reviewStatus === "approved") {
        inserts.push(
          createNotification({
            userId: params.userId,
            type: "scout_referral_won",
            title: `Your friend won ${bounty.title}!`,
            message:
              submission.reviewStatus === "claimed"
                ? `Your referred friend won ${bounty.title} (${bounty.company})! You earned +${scoutUsdc} USDC (10% Scout Cut).`
                : `Your referred friend was approved on ${bounty.title} (${bounty.company}) (+${scoutUsdc} USDC Scout Cut).`,
            href: `/bounties/${bounty.id}`,
            dedupeKey: `scout-win:${bounty.id}:${submission.evaluationId}:${submission.reviewStatus === "claimed" ? "paid" : "approved"}`,
            createdAt: submission.updatedAt,
          })
        );
      } else if (submission.reviewStatus === "pending_review") {
        inserts.push(
          createNotification({
            userId: params.userId,
            type: "scout_referral_qualified",
            title: `Friend qualified for ${bounty.title}`,
            message: `Your referred friend passed screening on ${bounty.title} (${bounty.company}) and reserved a winner slot (+${scoutUsdc} USDC on approval).`,
            href: `/bounties/${bounty.id}`,
            dedupeKey: `scout-qualified:${bounty.id}:${submission.evaluationId}`,
            createdAt: submission.updatedAt,
          })
        );
      } else if (submission.reviewStatus === "evaluating") {
        inserts.push(
          createNotification({
            userId: params.userId,
            type: "scout_referral_entered",
            title: `Friend entered ${bounty.title}`,
            message: `Someone used your Scout link to enter ${bounty.title} (${bounty.company}). You earn +${scoutUsdc} USDC if they win.`,
            href: `/bounties/${bounty.id}`,
            dedupeKey: `scout-enter:${bounty.id}:${submission.evaluationId}`,
            createdAt: submission.createdAt,
          })
        );
      }
    }

    for (const row of recruiterPendingRows) {
      const { submission, bounty } = row;
      if (submission.candidateUserId === params.userId) continue;
      inserts.push(
        createNotification({
          userId: params.userId,
          type: "bounty_submission_pending",
          title: `Qualified applicant ready · ${bounty.title}`,
          message: `A candidate passed the score threshold for ${bounty.title} (${bounty.company}) and is awaiting your review.`,
          href: `/bounties/${bounty.id}`,
          dedupeKey: `recruiter-pending:${bounty.id}:${submission.evaluationId}`,
          createdAt: submission.slotReservedAt ?? submission.updatedAt,
        })
      );
    }

    if (inserts.length > 0) {
      await Promise.all(inserts);
    }
  } catch {
    // Non-fatal sync failure
  }
}

export async function listUserNotifications(userId: string, limit = 25) {
  const rows = await db
    .select()
    .from(userNotifications)
    .where(eq(userNotifications.userId, userId))
    .orderBy(desc(userNotifications.createdAt))
    .limit(limit);

  const unreadCount = rows.filter((r) => !r.isRead).length;
  return {
    notifications: rows,
    unreadCount,
  };
}

export async function markUserNotificationsRead(params: {
  userId: string;
  ids?: string[];
  markAll?: boolean;
}) {
  if (params.markAll || !params.ids || params.ids.length === 0) {
    await db
      .update(userNotifications)
      .set({ isRead: true })
      .where(and(eq(userNotifications.userId, params.userId), eq(userNotifications.isRead, false)));
  } else {
    await db
      .update(userNotifications)
      .set({ isRead: true })
      .where(and(eq(userNotifications.userId, params.userId), inArray(userNotifications.id, params.ids)));
  }

  return listUserNotifications(params.userId);
}

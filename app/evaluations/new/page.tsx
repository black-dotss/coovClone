import React from "react";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { bounties, jobDescriptions } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  computeStakeAndBonusMetrics,
  getActiveRestriction,
  getBountySlotMetrics,
} from "@/lib/bounties/service";
import { NewEvaluationClient, type ActiveBountyTarget } from "./_client";

export const dynamic = "force-dynamic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewEvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{
    bountyId?: string;
    role?: string;
    ref?: string;
    scout?: string;
    referrer?: string;
  }>;
}) {
  const params = await searchParams;
  const bountyId = params.bountyId?.trim() || "";
  const initialRole = params.role?.trim() || "";
  const rawScout =
    params.ref?.trim() || params.scout?.trim() || params.referrer?.trim() || null;

  let initialBounty: ActiveBountyTarget | null = null;
  let initialRestriction: { reason: string; details: string } | null = null;

  if (bountyId && UUID_REGEX.test(bountyId)) {
    try {
      const [rowPromise, sessionPromise] = [
        db
          .select({
            bounty: bounties,
            rawText: jobDescriptions.rawText,
          })
          .from(bounties)
          .innerJoin(jobDescriptions, eq(bounties.jobDescriptionId, jobDescriptions.id))
          .where(
            or(eq(bounties.id, bountyId), eq(bounties.jobDescriptionId, bountyId))
          )
          .limit(1),
        getSession().catch(() => null),
      ];

      const [rows, session] = await Promise.all([rowPromise, sessionPromise]);
      const match = rows[0];

      if (match && match.bounty.status === "active") {
        const stakeMetrics = computeStakeAndBonusMetrics(match.bounty);
        const [slotMetrics, restriction] = await Promise.all([
          getBountySlotMetrics(match.bounty.id, match.bounty).catch(() => null),
          session?.user?.id
            ? getActiveRestriction({
                bountyId: match.bounty.id,
                userId: session.user.id,
              }).catch(() => null)
            : Promise.resolve(null),
        ]);

        initialBounty = {
          id: match.bounty.id,
          jobDescriptionId: match.bounty.jobDescriptionId,
          title: match.bounty.title,
          company: match.bounty.company,
          companyLogoUrl: match.bounty.companyLogoUrl,
          minScore: match.bounty.minScore,
          minStreak: match.bounty.minStreak,
          rewardPerWinnerUsdc: Number(match.bounty.rewardPerWinnerMicros) / 1_000_000,
          candidate90Usdc: stakeMetrics.candidate90Usdc,
          scout10Usdc: stakeMetrics.scout10Usdc,
          stakePercent: stakeMetrics.stakePercent,
          stakePerCandidateUsdc: stakeMetrics.stakePerCandidateUsdc,
          slashedPoolUsdc: stakeMetrics.slashedPoolUsdc,
          proRataBonusUsdc: stakeMetrics.proRataBonusUsdc,
          rawText: match.rawText,
          availableSlots: slotMetrics?.availableSlots,
        };

        if (restriction) {
          initialRestriction = {
            reason: restriction.reason,
            details: restriction.details,
          };
        }
      }
    } catch {
      // Fall back gracefully if Postgres read transiently fails
    }
  }

  return (
    <NewEvaluationClient
      key={initialBounty?.id ?? "standard"}
      initialBounty={initialBounty}
      initialRole={initialRole}
      initialRestriction={initialRestriction}
      initialScoutReferrer={rawScout}
    />
  );
}

import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  getBountyPublisherReviewWorkspace,
  reviewBountySubmissionDecision,
} from "@/lib/bounties/service";
import { createApiHandler, successResponse } from "@/lib/shared";

const ReviewActionSchema = z.object({
  submissionId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  recruiterNotes: z.string().max(2000).optional(),
});

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const workspace = await getBountyPublisherReviewWorkspace(id, session.user.id);
    return successResponse(workspace);
  }
);

export const POST = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;
    const body = await req.json();
    const parsed = ReviewActionSchema.parse(body);

    const updated = await reviewBountySubmissionDecision({
      bountyId: id,
      submissionId: parsed.submissionId,
      recruiterUserId: session.user.id,
      action: parsed.action,
      recruiterNotes: parsed.recruiterNotes,
    });

    return successResponse({
      submission: updated,
      payoutUnlocked: updated.reviewStatus === "approved",
    });
  }
);

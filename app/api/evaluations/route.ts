import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { createEvaluation, listUserEvaluations } from "@/lib/evaluations/service";
import { CreateEvaluationInputSchema } from "@/lib/evaluations/validation";
import {
  parseDeviceTokenFromCookie,
  parseHardwareTokenFromCookie,
} from "@/lib/devices/tokens";
import { extractClientIp } from "@/lib/devices/fingerprint";
import { dispatchEvaluationExecution } from "@/lib/evaluations/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const rawBody = await req.json();
  const validated = CreateEvaluationInputSchema.parse(rawBody);

  const rawCookieToken = parseDeviceTokenFromCookie(req.headers.get("cookie"));
  const rawHardwareToken = parseHardwareTokenFromCookie(req.headers.get("cookie"));
  const ipAddress = extractClientIp(req.headers);

  const evaluation = await createEvaluation({
    ownerUserId: session.user.id,
    cvVersionId: validated.cvVersionId,
    jobDescriptionId: validated.jobDescriptionId,
    tone: validated.tone,
    rawToken: rawCookieToken,
    rawHardwareToken,
    ipAddress,
    headers: req.headers,
  });

  // Launch execution through Cloudflare/Node unified runner
  await dispatchEvaluationExecution(evaluation.id);

  return successResponse(
    {
      evaluationId: evaluation.id,
      status: "queued" as const,
      tone: evaluation.tone,
      message: "Evaluation queued for background processing",
    },
    { status: 202 }
  );
});

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const userEvals = await listUserEvaluations(session.user.id);
  return successResponse(userEvals);
});

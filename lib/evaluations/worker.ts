import { db } from "@/lib/db";
import {
  evaluations,
  agentRuns,
  debateMessages,
  reports,
  cvVersions,
  jobDescriptions,
  documents,
} from "@/lib/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { computeCanonicalHashFromReportRecord } from "@/lib/solana/canonical-hash";
import {
  AgentOutput,
  AgentRole,
  AGENT_ROLES,
  DebateTurn,
  SynthesisReport,
  executeAgent,
  conductBoundedDebate,
  generateSynthesisReport,
} from "@/lib/agents";
import { ConcurrencyLimiter } from "@/lib/ai/providers/concurrency";
import { getAIProvider } from "@/lib/ai/providers";
import { LLMProvider } from "@/lib/ai/providers/types";
import { storage } from "@/lib/documents/storage";
import { extractDocumentText } from "@/lib/documents/extraction";
import { settleEvaluationCredit, releaseEvaluationCredit } from "@/lib/billing/ledger";
import { CreditReservation } from "@/lib/billing/types";
import { AppError, NotFoundError, ForbiddenError, BadRequestError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";
import {
  EvaluationProgress,
  EvaluationTone,
} from "./types";
import { getEvaluationProgress } from "./progress";

export interface WorkerExecutionOptions {
  provider?: LLMProvider;
  concurrencyLimit?: number;
  maxRetries?: number;
}

/**
 * Checkpoint-aware evaluation job processor.
 * Guarantees idempotency: reuses already-persisted agent runs and debate turns,
 * preventing duplicate AI calls and preventing double-settlement upon worker restart.
 */
export async function executeEvaluationWithCheckpoints(
  evaluationId: string,
  options?: WorkerExecutionOptions
): Promise<EvaluationProgress> {
  const provider = options?.provider ?? getAIProvider();
  const limiter = new ConcurrencyLimiter(options?.concurrencyLimit ?? 6);
  const maxRetries = options?.maxRetries ?? 3;

  // 1. Fetch current evaluation record
  const [evaluation] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (!evaluation) {
    throw new NotFoundError(`Evaluation ${evaluationId} not found`);
  }

  // Idempotency: If already terminal, return current progress immediately
  if (evaluation.status === "completed" || evaluation.status === "cancelled" || evaluation.status === "failed") {
    logger.info("Evaluation is already in terminal state; skipping execution", {
      evaluationId,
      status: evaluation.status,
    });
    return getEvaluationProgress(evaluationId, evaluation.ownerUserId);
  }

  // Transition to processing
  if (evaluation.status === "queued") {
    await db
      .update(evaluations)
      .set({
        status: "processing",
        updatedAt: new Date(),
      })
      .where(eq(evaluations.id, evaluationId));
  }

  // 2. Load CV and Job Description texts
  const [cvRecord] = await db
    .select()
    .from(cvVersions)
    .where(eq(cvVersions.id, evaluation.cvVersionId))
    .limit(1);

  const [jdRecord] = await db
    .select()
    .from(jobDescriptions)
    .where(eq(jobDescriptions.id, evaluation.jobDescriptionId))
    .limit(1);

  let cvText = cvRecord?.extractedText?.trim() ?? "";

  // Self-healing: If extractedText is missing or empty, extract directly from original document storage
  if (!cvText || cvText === "Candidate CV with professional experience." || cvText.length < 50) {
    try {
      if (cvRecord?.sourceDocumentId) {
        const [doc] = await db
          .select()
          .from(documents)
          .where(eq(documents.id, cvRecord.sourceDocumentId))
          .limit(1);

        if (doc && doc.privateStorageKey) {
          logger.info("Self-healing: extracting text from stored document", {
            evaluationId,
            documentId: doc.id,
            storageKey: doc.privateStorageKey,
          });

          const buffer = await storage.getObject(doc.privateStorageKey);
          const extraction = await extractDocumentText(buffer, doc.mimeType);

          if (extraction.text && extraction.text.trim().length > 0) {
            cvText = extraction.text.trim();

            await db
              .update(documents)
              .set({
                extractedText: cvText,
                extractedTextStatus: "completed",
              })
              .where(eq(documents.id, doc.id));

            await db
              .update(cvVersions)
              .set({
                extractedText: cvText,
              })
              .where(eq(cvVersions.id, cvRecord.id));

            logger.info("Self-healing text extraction succeeded and persisted", {
              evaluationId,
              extractedChars: cvText.length,
            });
          }
        }
      }
    } catch (healErr) {
      logger.warn("Self-healing document text extraction failed; proceeding with fallback", {
        evaluationId,
        error: String(healErr),
      });
    }
  }

  if (!cvText || cvText === "Candidate CV with professional experience." || cvText.length < 50) {
    logger.error("Evaluation aborted: CV text is missing or insufficient", {
      evaluationId,
      cvTextLength: cvText?.length ?? 0,
    });

    const creditReservation = (evaluation.workflowState as Record<string, unknown> | null)?.creditReservation as CreditReservation | undefined;
    if (creditReservation) {
      try {
        await releaseEvaluationCredit({
          userId: evaluation.ownerUserId,
          reservation: creditReservation,
          reason: "insufficient_cv_text",
        });
      } catch (relErr) {
        logger.warn("Failed releasing credit for aborted evaluation", { evaluationId, error: relErr });
      }
    }

    await db
      .update(evaluations)
      .set({
        status: "failed",
        errorMessage: "Unable to extract readable text from the CV document. Please re-upload a readable PDF or DOCX file.",
        updatedAt: new Date(),
      })
      .where(eq(evaluations.id, evaluationId));

    return getEvaluationProgress(evaluationId, evaluation.ownerUserId);
  }

  const jdText = jdRecord?.rawText ?? "Job description requirements.";

  try {
    // 3. Checkpoint Step 1: Agent Assessments
    // Inspect database for completed agent runs from previous attempts
    const existingRuns = await db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.evaluationId, evaluationId),
          eq(agentRuns.status, "completed")
        )
      );

    const completedAgentsMap: Partial<Record<AgentRole, AgentOutput>> = {};
    for (const run of existingRuns) {
      if (run.structuredResult) {
        completedAgentsMap[run.agentRole as AgentRole] = run.structuredResult as unknown as AgentOutput;
      }
    }

    logger.info("Checkpoint inspection: recovered completed agents", {
      evaluationId,
      recoveredCount: Object.keys(completedAgentsMap).length,
    });

    // Execute only missing agents
    const missingRoles = AGENT_ROLES.filter((role) => !completedAgentsMap[role]);

    if (missingRoles.length > 0) {
      const agentPromises = missingRoles.map((role) =>
        limiter.run(async () => {
          // Check cancellation before launching agent
          await assertNotCancelled(evaluationId);

          const res = await executeAgent(
            {
              agentRole: role,
              cvText,
              jdText,
              tone: evaluation.tone as EvaluationTone,
            },
            provider
          );

          completedAgentsMap[role] = res.output;

          // Persist agent run immediately as a checkpoint
          await db.insert(agentRuns).values({
            evaluationId,
            agentRole: role,
            status: "completed",
            modelVersion: res.model,
            structuredResult: res.output as unknown as Record<string, unknown>,
            scoreContribution: Math.round(res.output.scoreContribution),
            promptTokens: res.promptTokens,
            completionTokens: res.completionTokens,
            durationMs: res.durationMs,
          });

          // Touch evaluation updatedAt as a live heartbeat
          await db
            .update(evaluations)
            .set({ updatedAt: new Date() })
            .where(eq(evaluations.id, evaluationId));
        })
      );

      await Promise.all(agentPromises);
    }

    // Check cancellation before debate
    await assertNotCancelled(evaluationId);

    // 4. Checkpoint Step 2: Moderated Debate
    const existingTurns = await db
      .select()
      .from(debateMessages)
      .where(eq(debateMessages.evaluationId, evaluationId));

    let debateTurns: DebateTurn[] = existingTurns.map((m) => ({
      sequence: m.sequence,
      agentRole: m.agentRole as AgentRole,
      content: m.content,
      evidenceReferences: (m.evidenceReferences as string[]) ?? [],
    }));

    if (debateTurns.length === 0) {
      const debateResult = await conductBoundedDebate(
        completedAgentsMap as Record<AgentRole, AgentOutput>,
        evaluation.tone as EvaluationTone,
        provider,
        async (turn) => {
          // Persist each debate turn as it is generated
          await db.insert(debateMessages).values({
            evaluationId,
            sequence: turn.sequence,
            agentRole: turn.agentRole,
            content: turn.content,
            evidenceReferences: turn.evidenceReferences,
          });

          await db
            .update(evaluations)
            .set({ updatedAt: new Date() })
            .where(eq(evaluations.id, evaluationId));
        }
      );
      debateTurns = debateResult.turns;
    }

    // Check cancellation before final synthesis
    await assertNotCancelled(evaluationId);

    // 5. Step 3: Synthesis Report Generation
    const [existingReportRecord] = await db
      .select()
      .from(reports)
      .where(eq(reports.evaluationId, evaluationId))
      .limit(1);

    let finalReport: SynthesisReport;
    if (existingReportRecord) {
      finalReport = existingReportRecord.structuredReport as unknown as SynthesisReport;
    } else {
      finalReport = generateSynthesisReport(
        completedAgentsMap as Record<AgentRole, AgentOutput>,
        debateTurns,
        cvText,
        jdText,
        evaluation.tone as EvaluationTone
      );
    }

    const latestRuns = await db
      .select({
        agentRole: agentRuns.agentRole,
        scoreContribution: agentRuns.scoreContribution,
        modelVersion: agentRuns.modelVersion,
      })
      .from(agentRuns)
      .where(eq(agentRuns.evaluationId, evaluationId));

    const resolvedModelVersion =
      latestRuns.find((r) => r.modelVersion && r.modelVersion.length > 0)?.modelVersion ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";

    const canonical = await computeCanonicalHashFromReportRecord({
      evaluationId,
      jobDescriptionId: evaluation.jobDescriptionId,
      structuredReport: finalReport as unknown as Record<string, unknown>,
      agentRuns: latestRuns,
      overrideScore: Math.round(finalReport.overallScore),
      overrideVerdict: finalReport.verdict,
      modelVersion: resolvedModelVersion,
      defenseRevisionsCount: 0,
    });

    if (!existingReportRecord) {
      await db.insert(reports).values({
        evaluationId,
        structuredReport: finalReport as unknown as Record<string, unknown>,
        canonicalReportHash: canonical.hashHex,
        redactedSnapshot: canonical.redactedSnapshot,
      });
    } else if (!existingReportRecord.canonicalReportHash) {
      await db
        .update(reports)
        .set({
          canonicalReportHash: canonical.hashHex,
          redactedSnapshot: canonical.redactedSnapshot,
          updatedAt: new Date(),
        })
        .where(eq(reports.id, existingReportRecord.id));
    }

    // 6. Settle Quota Credit
    const workflowState = (evaluation.workflowState ?? {}) as Record<string, unknown>;
    const reservation = workflowState.creditReservation as CreditReservation | undefined;
    if (reservation) {
      try {
        await settleEvaluationCredit({
          userId: evaluation.ownerUserId,
          reservation,
          evaluationId,
        });
        logger.info("Settled evaluation quota credit", { evaluationId, reservationId: reservation.reservationId });
      } catch (err) {
        logger.warn("Could not settle credit in evaluation worker", { error: err });
      }
    }

    // 7. Transition to completed
    await db
      .update(evaluations)
      .set({
        status: "completed",
        overallScore: Math.round(finalReport.overallScore),
        verdict: finalReport.verdict,
        modelVersion: resolvedModelVersion,
        canonicalReportHash: canonical.hashHex,
        updatedAt: new Date(),
      })
      .where(eq(evaluations.id, evaluationId));

    logger.info("Evaluation completed successfully", {
      evaluationId,
      overallScore: Math.round(finalReport.overallScore),
      verdict: finalReport.verdict,
    });

    return getEvaluationProgress(evaluationId, evaluation.ownerUserId);
  } catch (err) {
    if (err instanceof AppError && err.code === "CONFLICT" && err.message.includes("cancelled")) {
      logger.info("Evaluation was cancelled by user; halting processing", { evaluationId });
      return getEvaluationProgress(evaluationId, evaluation.ownerUserId);
    }

    logger.error("Error executing evaluation in worker", {
      evaluationId,
      error: err instanceof Error ? err.message : String(err),
    });

    // Check retry eligibility
    const currentState = (evaluation.workflowState ?? {}) as Record<string, unknown>;
    const currentRetries = (currentState.retryCount as number) ?? 0;
    const errText = err instanceof Error ? err.message : String(err);
    const isFatalQuota = errText.includes("429") || errText.includes("RESOURCE_EXHAUSTED") || errText.includes("quota exceeded");

    if (currentRetries < maxRetries && !isFatalQuota) {
      // Record retry attempt without failing permanently
      await db
        .update(evaluations)
        .set({
          workflowState: {
            ...currentState,
            retryCount: currentRetries + 1,
            lastRetryAt: new Date().toISOString(),
            lastError: errText,
          },
          updatedAt: new Date(),
        })
        .where(eq(evaluations.id, evaluationId));

      throw err;
    }

    // Retries exhausted or fatal quota error: mark as failed and release credit
    await db
      .update(evaluations)
      .set({
        status: "failed",
        errorMessage: isFatalQuota
          ? "Gemini API daily free quota exceeded. Please check your API key in Google AI Studio or update GEMINI_API_KEY."
          : (err instanceof Error ? err.message : "Evaluation failed after maximum retries"),
        updatedAt: new Date(),
      })
      .where(eq(evaluations.id, evaluationId));

    const reservation = currentState.creditReservation as CreditReservation | undefined;
    if (reservation) {
      try {
        await releaseEvaluationCredit({
          userId: evaluation.ownerUserId,
          reservation,
          reason: "provider_outage_or_exhaustion",
        });
        logger.info("Released evaluation credit on permanent worker failure", { evaluationId });
      } catch (releaseErr) {
        logger.warn("Failed releasing credit after evaluation failure", { releaseErr });
      }
    }

    throw err;
  }
}

/**
 * Checks if the evaluation has been marked as cancelled in the database.
 */
async function assertNotCancelled(evaluationId: string): Promise<void> {
  const [curr] = await db
    .select({ status: evaluations.status })
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (curr && curr.status === "cancelled") {
    throw new AppError("Evaluation was cancelled by user", 409, "CONFLICT");
  }
}

/**
 * Cancels a queued or processing evaluation and releases reserved credits.
 */
export async function cancelEvaluation(
  evaluationId: string,
  requestingUserId: string
): Promise<EvaluationProgress> {
  const [evaluation] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.id, evaluationId))
    .limit(1);

  if (!evaluation) {
    throw new NotFoundError("Evaluation not found");
  }

  if (evaluation.ownerUserId !== requestingUserId) {
    throw new ForbiddenError("You do not have access to this evaluation");
  }

  if (evaluation.status === "completed" || evaluation.status === "failed") {
    throw new BadRequestError(`Cannot cancel an evaluation that is already ${evaluation.status}`);
  }

  if (evaluation.status === "cancelled") {
    return getEvaluationProgress(evaluationId, requestingUserId);
  }

  // Update status to cancelled
  await db
    .update(evaluations)
    .set({
      status: "cancelled",
      updatedAt: new Date(),
    })
    .where(eq(evaluations.id, evaluationId));

  // Release credit reservation
  const workflowState = (evaluation.workflowState ?? {}) as Record<string, unknown>;
  const reservation = workflowState.creditReservation as CreditReservation | undefined;
  if (reservation) {
    try {
      await releaseEvaluationCredit({
        userId: requestingUserId,
        reservation,
        reason: "user_cancelled",
      });
      logger.info("Released evaluation credit on user cancellation", { evaluationId });
    } catch (err) {
      logger.warn("Failed releasing credit on cancellation", { error: err });
    }
  }

  return getEvaluationProgress(evaluationId, requestingUserId);
}

/**
 * Recovers stale evaluations stuck in 'processing' without updates.
 */
export async function recoverStaleJobs(
  staleThresholdMs = 300_000,
  options?: WorkerExecutionOptions
): Promise<number> {
  const thresholdDate = new Date(Date.now() - staleThresholdMs);

  const staleEvaluations = await db
    .select()
    .from(evaluations)
    .where(
      and(
        eq(evaluations.status, "processing"),
        lt(evaluations.updatedAt, thresholdDate)
      )
    );

  logger.info(`Found ${staleEvaluations.length} stale evaluations for recovery`, {
    staleCount: staleEvaluations.length,
    thresholdDate,
  });

  let recoveredCount = 0;
  for (const evaluation of staleEvaluations) {
    try {
      await executeEvaluationWithCheckpoints(evaluation.id, options);
      recoveredCount++;
    } catch (err) {
      logger.error(`Failed recovering stale evaluation ${evaluation.id}`, { error: err });
    }
  }

  return recoveredCount;
}

export { getEvaluationProgress } from "./progress";


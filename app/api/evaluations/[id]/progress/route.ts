import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { getEvaluationProgress } from "@/lib/evaluations/progress";
import { dispatchEvaluationExecution } from "@/lib/evaluations/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createApiHandler(
  async (req: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireAuth(req.headers);
    const { id } = await context.params;

    const url = new URL(req.url);
    const isStreamRequested =
      req.headers.get("accept")?.includes("text/event-stream") ||
      url.searchParams.get("stream") === "true";

    // Immediate snapshot
    const initialProgress = await getEvaluationProgress(id, session.user.id);

    // Auto-heal / self-trigger execution if evaluation is queued or stalled
    if (initialProgress.status === "queued" || initialProgress.status === "processing") {
      await dispatchEvaluationExecution(id);
    }

    if (!isStreamRequested) {
      // Standard polling response
      return successResponse(initialProgress);
    }

    // Server-Sent Events (SSE) response
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;

        const sendEvent = (event: string, data: unknown) => {
          if (isClosed) return;
          const json = JSON.stringify(data);
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${json}\n\n`));
        };

        const sendPing = () => {
          if (isClosed) return;
          controller.enqueue(encoder.encode(": ping\n\n"));
        };

        // Send immediate initial event
        sendEvent("progress", initialProgress);

        if (initialProgress.isTerminal) {
          isClosed = true;
          try {
            controller.close();
          } catch {
            // Already closed
          }
          return;
        }

        let loopCounter = 0;
        let lastTriggerTime = Date.now();

        try {
          while (!isClosed) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (isClosed) break;

            loopCounter++;
            if (loopCounter % 15 === 0) {
              sendPing();
            }

            const currentProgress = await getEvaluationProgress(id, session.user.id);
            sendEvent("progress", currentProgress);

            if (currentProgress.isTerminal) {
              isClosed = true;
              try {
                controller.close();
              } catch {
                // Already closed
              }
              break;
            }

            // Periodic safety check: if still queued or processing after 20 seconds, re-verify worker dispatch
            if (
              (currentProgress.status === "queued" || currentProgress.status === "processing") &&
              Date.now() - lastTriggerTime > 20_000
            ) {
              lastTriggerTime = Date.now();
              await dispatchEvaluationExecution(id);
            }
          }
        } catch (err) {
          if (!isClosed) {
            sendEvent("error", {
              message: err instanceof Error ? err.message : "Failed streaming progress",
            });
            isClosed = true;
            try {
              controller.close();
            } catch {
              // Ignore closure race
            }
          }
        }
      },
      cancel() {
        // Stream cancelled by consumer
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
);

import { requireAuth } from "@/lib/auth";
import { getEvaluationReport } from "@/lib/reports/service";
import { generateReportPdf } from "@/lib/reports/pdf";
import { recordAuditEvent } from "@/lib/operations/audit";
import { assertRateLimit } from "@/lib/operations/rate-limiter";
import { errorResponse } from "@/lib/shared";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const session = await requireAuth(req.headers);
    assertRateLimit(session.user.id, "api");

    const { id } = await context.params;
    const report = await getEvaluationReport(id, session.user.id);

    const pdfBuffer = await generateReportPdf(report);

    await recordAuditEvent({
      userId: session.user.id,
      action: "report.exported_pdf",
      targetType: "report",
      targetId: report.id,
      metadata: { evaluationId: id },
    });

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="cookmycv-report-${id.slice(0, 8)}.pdf"`,
        "Content-Length": String(pdfBuffer.length),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

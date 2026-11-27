import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { listCvVersions, createCvVersion } from "@/lib/documents/versions";
import { BadRequestError } from "@/lib/shared/errors";
import { z } from "zod";

const CreateCvVersionSchema = z.object({
  sourceDocumentId: z.string().uuid("Invalid source document ID"),
  extractedText: z.string().min(10, "Extracted text must be at least 10 characters"),
});

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const { searchParams } = new URL(req.url);
  const documentId = searchParams.get("documentId");

  if (!documentId) {
    throw new BadRequestError("Missing required query parameter: documentId");
  }

  const versions = await listCvVersions(documentId, session.user.id);
  return successResponse(versions);
});

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const input = CreateCvVersionSchema.parse(body);

  const created = await createCvVersion(
    session.user.id,
    input.sourceDocumentId,
    input.extractedText
  );

  return successResponse(created, { status: 201 });
});

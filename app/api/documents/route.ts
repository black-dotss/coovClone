import { createApiHandler, successResponse } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { uploadAndProcessDocument, listUserDocuments } from "@/lib/documents";
import { BadRequestError } from "@/lib/shared/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const docs = await listUserDocuments(session.user.id);
  return successResponse(docs);
});

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);

  const formData = await req.formData();
  const file = formData.get("file");
  const docType = formData.get("type");

  if (!file || typeof file === "string") {
    throw new BadRequestError("A document file is required in the 'file' field");
  }

  const fileBlob = file as File;
  const arrayBuffer = await fileBlob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const doc = await uploadAndProcessDocument({
    ownerUserId: session.user.id,
    filename: fileBlob.name || "document.pdf",
    declaredMimeType: fileBlob.type,
    buffer,
    documentType: docType === "cover_letter" ? "cover_letter" : "cv",
  });

  return successResponse(
    {
      ...doc,
      document: doc,
      cvVersion: doc.cvVersion || null,
      cvVersionId: doc.cvVersionId || null,
    },
    { status: 201 }
  );
});

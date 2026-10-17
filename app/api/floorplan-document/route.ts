import { NextResponse } from "next/server";

import { FLOORPLAN_DOCUMENT_VERSION, type FloorplanDocument } from "@/lib/floorplan/types";
import { readJsonCapped } from "@/lib/http";
import { loadApprovedPlan } from "@/lib/ownership";
import { requireSession } from "@/lib/server-auth";
import {
  DOCUMENTS_TABLE,
  GENERATED_PREFIX,
  getAdminSupabase,
  serverConfigMissingResponse,
} from "@/lib/supabase-server";

// A plan's document is a few hundred kilobytes at most; anything far beyond is not one.
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

type SaveBody = {
  imageId?: number;
  imagePath?: string;
  document?: FloorplanDocument;
};

function isValidDocument(document: FloorplanDocument | undefined): document is FloorplanDocument {
  if (!document) {
    return false;
  }

  return (
    document.version === FLOORPLAN_DOCUMENT_VERSION &&
    typeof document.canvas?.width === "number" &&
    typeof document.canvas?.height === "number" &&
    Array.isArray(document.objects)
  );
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  const { searchParams } = new URL(request.url);
  const imageId = Number(searchParams.get("imageId"));
  const filePath = searchParams.get("imagePath")?.trim() ?? "";

  if (!Number.isFinite(imageId) || !filePath.startsWith(GENERATED_PREFIX)) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }

  const access = await loadApprovedPlan(adminSupabase, session, { imageId, imagePath: filePath });
  if (!access.ok) {
    return access.response;
  }

  const { data: row, error } = await adminSupabase
    .from(DOCUMENTS_TABLE)
    .select("document, source_document, published_document, updated_at")
    .eq("image_id", imageId)
    .eq("file_path", filePath)
    .maybeSingle();

  if (error) {
    console.error("Failed to load floor plan document", error);
    return NextResponse.json({ message: "Kunde inte ladda planritningsdata." }, { status: 500 });
  }

  if (!row?.document) {
    return NextResponse.json({ message: "Inget sparat dokument hittades." }, { status: 404 });
  }

  return NextResponse.json({
    document: row.document as FloorplanDocument,
    // The plan as first created (an imported scan), which "Original" returns to.
    sourceDocument: (row.source_document as FloorplanDocument | null) ?? null,
    // The plan as last finished, which downloads are made from.
    publishedDocument: (row.published_document as FloorplanDocument | null) ?? null,
    updatedAt: row.updated_at,
  });
}

export async function PUT(request: Request) {
  const session = await requireSession();
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  const read = await readJsonCapped<SaveBody>(request, MAX_DOCUMENT_BYTES);
  if (!read.ok) {
    return read.response;
  }
  const body = read.data;
  const imageId = typeof body.imageId === "number" ? body.imageId : Number.NaN;
  const filePath = body.imagePath?.trim() ?? "";

  if (!Number.isFinite(imageId) || !filePath.startsWith(GENERATED_PREFIX)) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }

  if (!isValidDocument(body.document)) {
    return NextResponse.json({ message: "Ogiltigt planritningsdokument." }, { status: 400 });
  }

  const access = await loadApprovedPlan(adminSupabase, session, { imageId, imagePath: filePath }, { forChange: true });
  if (!access.ok) {
    return access.response;
  }

  const updatedAt = new Date().toISOString();
  const document: FloorplanDocument = {
    ...body.document,
    meta: {
      ...body.document.meta,
      imageId,
      imagePath: filePath,
      updatedAt,
    },
  };

  const { error } = await adminSupabase.from(DOCUMENTS_TABLE).upsert(
    {
      image_id: imageId,
      file_path: filePath,
      document,
      updated_at: updatedAt,
    },
    {
      onConflict: "image_id,file_path",
    },
  );

  if (error) {
    console.error("Failed to save floor plan document", error);
    return NextResponse.json({ message: "Kunde inte spara planritningsdata." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    updatedAt,
  });
}

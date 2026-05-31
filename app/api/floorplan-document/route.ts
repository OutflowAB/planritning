import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { FLOORPLAN_DOCUMENT_VERSION, type FloorplanDocument } from "@/lib/floorplan/types";

const UPLOADS_TABLE = "uploaded_images";
const REVIEWS_TABLE = "generation_reviews";
const DOCUMENTS_TABLE = "floor_plan_documents";
const GENERATED_PREFIX = "generated/";

type SaveBody = {
  imageId?: number;
  imagePath?: string;
  document?: FloorplanDocument;
};

function createAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

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

async function assertApprovedGeneratedImage(
  adminSupabase: NonNullable<ReturnType<typeof createAdminSupabaseClient>>,
  imageId: number,
  filePath: string,
) {
  const { data: imageRow, error: imageError } = await adminSupabase
    .from(UPLOADS_TABLE)
    .select("id, file_path")
    .eq("id", imageId)
    .eq("file_path", filePath)
    .like("file_path", `${GENERATED_PREFIX}%`)
    .maybeSingle();

  if (imageError || !imageRow) {
    return { ok: false as const, status: 404, message: "Den valda bilden hittades inte." };
  }

  const { data: reviewRow, error: reviewError } = await adminSupabase
    .from(REVIEWS_TABLE)
    .select("id")
    .eq("image_id", imageRow.id)
    .eq("decision", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reviewError || !reviewRow) {
    return { ok: false as const, status: 403, message: "Bilden är inte godkänd ännu." };
  }

  return { ok: true as const };
}

export async function GET(request: Request) {
  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase) {
    return NextResponse.json({ message: "Serverkonfiguration saknas." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const imageId = Number(searchParams.get("imageId"));
  const filePath = searchParams.get("imagePath")?.trim() ?? "";

  if (!Number.isFinite(imageId) || !filePath.startsWith(GENERATED_PREFIX)) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }

  const access = await assertApprovedGeneratedImage(adminSupabase, imageId, filePath);
  if (!access.ok) {
    return NextResponse.json({ message: access.message }, { status: access.status });
  }

  const { data: row, error } = await adminSupabase
    .from(DOCUMENTS_TABLE)
    .select("document, updated_at")
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
    updatedAt: row.updated_at,
  });
}

export async function PUT(request: Request) {
  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase) {
    return NextResponse.json({ message: "Serverkonfiguration saknas." }, { status: 500 });
  }

  const body = (await request.json()) as SaveBody;
  const imageId = typeof body.imageId === "number" ? body.imageId : Number.NaN;
  const filePath = body.imagePath?.trim() ?? "";

  if (!Number.isFinite(imageId) || !filePath.startsWith(GENERATED_PREFIX)) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }

  if (!isValidDocument(body.document)) {
    return NextResponse.json({ message: "Ogiltigt planritningsdokument." }, { status: 400 });
  }

  const access = await assertApprovedGeneratedImage(adminSupabase, imageId, filePath);
  if (!access.ok) {
    return NextResponse.json({ message: access.message }, { status: access.status });
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

export async function DELETE(request: Request) {
  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase) {
    return NextResponse.json({ message: "Serverkonfiguration saknas." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const imageId = Number(searchParams.get("imageId"));
  const filePath = searchParams.get("imagePath")?.trim() ?? "";

  if (!Number.isFinite(imageId) || !filePath.startsWith(GENERATED_PREFIX)) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }

  const access = await assertApprovedGeneratedImage(adminSupabase, imageId, filePath);
  if (!access.ok) {
    return NextResponse.json({ message: access.message }, { status: access.status });
  }

  const { error } = await adminSupabase
    .from(DOCUMENTS_TABLE)
    .delete()
    .eq("image_id", imageId)
    .eq("file_path", filePath);

  if (error) {
    console.error("Failed to delete floor plan document", error);
    return NextResponse.json({ message: "Kunde inte ta bort planritningsdata." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

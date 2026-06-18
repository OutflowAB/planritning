import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const REVIEWS_TABLE = "generation_reviews";
const DOCUMENTS_TABLE = "floor_plan_documents";
const GENERATED_PREFIX = "generated/";

type PublishBody = {
  imageId?: number;
  imagePath?: string;
  pngDataUrl?: string;
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

function parsePngDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match?.[1]) {
    return null;
  }

  return Buffer.from(match[1], "base64");
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

export async function POST(request: Request) {
  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase) {
    return NextResponse.json({ message: "Serverkonfiguration saknas." }, { status: 500 });
  }

  const body = (await request.json()) as PublishBody;
  const imageId = typeof body.imageId === "number" ? body.imageId : Number.NaN;
  const filePath = body.imagePath?.trim() ?? "";
  const pngBuffer = body.pngDataUrl ? parsePngDataUrl(body.pngDataUrl) : null;

  if (!Number.isFinite(imageId) || !filePath.startsWith(GENERATED_PREFIX)) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }

  if (!pngBuffer || pngBuffer.byteLength === 0) {
    return NextResponse.json({ message: "Ogiltig bilddata." }, { status: 400 });
  }

  const access = await assertApprovedGeneratedImage(adminSupabase, imageId, filePath);
  if (!access.ok) {
    return NextResponse.json({ message: access.message }, { status: access.status });
  }

  const { error: uploadError } = await adminSupabase.storage.from(BUCKET_NAME).upload(filePath, pngBuffer, {
    upsert: true,
    contentType: "image/png",
  });

  if (uploadError) {
    console.error("Failed to publish floor plan image", uploadError);
    return NextResponse.json({ message: "Kunde inte spara den färdiga planritningen." }, { status: 500 });
  }

  const { error: metadataError } = await adminSupabase
    .from(UPLOADS_TABLE)
    .update({
      file_size: pngBuffer.byteLength,
      mime_type: "image/png",
    })
    .eq("id", imageId)
    .eq("file_path", filePath);

  if (metadataError) {
    console.error("Failed to update published image metadata", metadataError);
    return NextResponse.json({ message: "Kunde inte uppdatera bildmetadata." }, { status: 500 });
  }

  const { error: documentDeleteError } = await adminSupabase
    .from(DOCUMENTS_TABLE)
    .delete()
    .eq("image_id", imageId)
    .eq("file_path", filePath);

  if (documentDeleteError) {
    console.error("Failed to clear floor plan document after publish", documentDeleteError);
    return NextResponse.json({ message: "Kunde inte rensa redigeringsdata efter publicering." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

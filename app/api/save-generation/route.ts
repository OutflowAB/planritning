import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

const UPLOADS_TABLE = "uploaded_images";
const REVIEWS_TABLE = "generation_reviews";
const GENERATED_PREFIX = "generated/";

type SaveBody = {
  imageId?: number;
  filePath?: string;
};

export async function POST(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  const body = (await request.json()) as SaveBody;
  const imageId = typeof body.imageId === "number" ? body.imageId : Number.NaN;
  const filePath = body.filePath?.trim() ?? "";

  if (!Number.isFinite(imageId) || !filePath.startsWith(GENERATED_PREFIX)) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }

  const { data: imageRow, error: imageError } = await adminSupabase
    .from(UPLOADS_TABLE)
    .select("id, file_path, saved_at")
    .eq("id", imageId)
    .eq("file_path", filePath)
    .like("file_path", `${GENERATED_PREFIX}%`)
    .maybeSingle();

  if (imageError || !imageRow) {
    return NextResponse.json({ message: "Den valda bilden hittades inte." }, { status: 404 });
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
    return NextResponse.json({ message: "Bilden är inte godkänd ännu." }, { status: 403 });
  }

  if (imageRow.saved_at) {
    return NextResponse.json({
      success: true,
      alreadySaved: true,
      savedAt: imageRow.saved_at,
    });
  }

  const savedAt = new Date().toISOString();
  const { error: updateError } = await adminSupabase
    .from(UPLOADS_TABLE)
    .update({ saved_at: savedAt })
    .eq("id", imageRow.id)
    .eq("file_path", filePath);

  if (updateError) {
    console.error("Failed to save generated image", updateError);
    return NextResponse.json({ message: "Kunde inte spara bilden just nu." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    savedAt,
  });
}

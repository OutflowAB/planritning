import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const REVIEWS_TABLE = "generation_reviews";
const GENERATED_PREFIX = "generated/";

export async function GET(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  const { searchParams } = new URL(request.url);
  const imageIdParam = searchParams.get("imageId") ?? searchParams.get("previewImageId");
  const imagePathParam = searchParams.get("imagePath") ?? searchParams.get("previewImagePath");

  if (!imageIdParam && !imagePathParam) {
    return NextResponse.json({ message: "Ingen bild vald." }, { status: 400 });
  }

  let query = adminSupabase
    .from(UPLOADS_TABLE)
    .select("id, file_name, file_path, created_at, saved_at")
    .like("file_path", `${GENERATED_PREFIX}%`);

  if (imageIdParam) {
    const imageId = Number(imageIdParam);
    if (!Number.isFinite(imageId)) {
      return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
    }
    query = query.eq("id", imageId);
  } else if (imagePathParam) {
    if (!imagePathParam.startsWith(GENERATED_PREFIX)) {
      return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
    }
    query = query.eq("file_path", imagePathParam);
  }

  const { data: imageRow, error: imageError } = await query.maybeSingle();

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

  const { data: signedData, error: signError } = await adminSupabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(imageRow.file_path, 3600);

  if (signError || !signedData?.signedUrl) {
    return NextResponse.json({ message: "Kunde inte ladda bildförhandsvisningen." }, { status: 500 });
  }

  return NextResponse.json({
    image: {
      id: imageRow.id,
      file_name: imageRow.file_name,
      file_path: imageRow.file_path,
      created_at: imageRow.created_at,
      preview_url: signedData.signedUrl,
      is_saved: Boolean(imageRow.saved_at),
    },
  });
}

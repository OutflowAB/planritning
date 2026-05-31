import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const REVIEWS_TABLE = "generation_reviews";
const GENERATED_PREFIX = "generated/";

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

export async function GET(request: Request) {
  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase) {
    return NextResponse.json({ message: "Serverkonfiguration saknas." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const imageIdParam = searchParams.get("imageId");
  const imagePathParam = searchParams.get("imagePath");

  if (!imageIdParam && !imagePathParam) {
    return NextResponse.json({ message: "Ingen bild vald." }, { status: 400 });
  }

  let query = adminSupabase
    .from(UPLOADS_TABLE)
    .select("id, file_path, mime_type")
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

  const { data: fileData, error: downloadError } = await adminSupabase.storage
    .from(BUCKET_NAME)
    .download(imageRow.file_path);

  if (downloadError || !fileData) {
    console.error("Failed to download floor plan image", downloadError);
    return NextResponse.json({ message: "Kunde inte ladda planritningsbilden." }, { status: 500 });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": imageRow.mime_type ?? "image/png",
      "Cache-Control": "no-store",
    },
  });
}

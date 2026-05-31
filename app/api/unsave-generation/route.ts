import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const UPLOADS_TABLE = "uploaded_images";
const REVIEWS_TABLE = "generation_reviews";
const GENERATED_PREFIX = "generated/";

type UnsaveBody = {
  imageId?: number;
  filePath?: string;
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

export async function POST(request: Request) {
  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase) {
    return NextResponse.json({ message: "Serverkonfiguration saknas." }, { status: 500 });
  }

  const body = (await request.json()) as UnsaveBody;
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

  if (!imageRow.saved_at) {
    return NextResponse.json({ success: true, alreadyUnsaved: true });
  }

  const { error: updateError } = await adminSupabase
    .from(UPLOADS_TABLE)
    .update({ saved_at: null })
    .eq("id", imageRow.id)
    .eq("file_path", filePath);

  if (updateError) {
    console.error("Failed to unsave generated image", updateError);
    return NextResponse.json({ message: "Kunde inte skicka tillbaka till verktyg." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

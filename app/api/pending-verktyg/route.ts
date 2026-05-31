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

export async function GET() {
  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase) {
    return NextResponse.json({ message: "Serverkonfiguration saknas." }, { status: 500 });
  }

  const { data: reviewRows, error: reviewError } = await adminSupabase
    .from(REVIEWS_TABLE)
    .select("image_id")
    .eq("decision", "approved")
    .not("image_id", "is", null);

  if (reviewError) {
    console.error("Failed to load approved reviews", reviewError);
    return NextResponse.json({ message: "Kunde inte hämta verktygslistan." }, { status: 500 });
  }

  const approvedImageIds = [
    ...new Set(
      (reviewRows ?? [])
        .map((row) => row.image_id)
        .filter((imageId): imageId is number => typeof imageId === "number"),
    ),
  ];

  if (approvedImageIds.length === 0) {
    return NextResponse.json({ images: [] });
  }

  const { data: imageRows, error: imageError } = await adminSupabase
    .from(UPLOADS_TABLE)
    .select("id, file_name, file_path, created_at")
    .like("file_path", `${GENERATED_PREFIX}%`)
    .is("saved_at", null)
    .in("id", approvedImageIds)
    .order("created_at", { ascending: false });

  if (imageError) {
    console.error("Failed to load pending verktyg images", imageError);
    return NextResponse.json({ message: "Kunde inte hämta verktygslistan." }, { status: 500 });
  }

  const rows = imageRows ?? [];
  const previewByPath = new Map<string, string>();

  if (rows.length > 0) {
    const paths = rows.map((row) => row.file_path);
    const { data: signedData, error: signError } = await adminSupabase.storage
      .from(BUCKET_NAME)
      .createSignedUrls(paths, 3600);

    if (signError) {
      console.error("Failed to sign pending verktyg previews", signError);
    } else {
      signedData?.forEach((item, index) => {
        if (item?.signedUrl) {
          previewByPath.set(paths[index], item.signedUrl);
        }
      });
    }
  }

  return NextResponse.json({
    images: rows.map((row) => ({
      id: row.id,
      file_name: row.file_name,
      file_path: row.file_path,
      created_at: row.created_at,
      preview_url: previewByPath.get(row.file_path) ?? null,
    })),
  });
}

import { createHash } from "node:crypto";

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

  // The file at this path is replaced when a plan is republished, so it cannot be immutable.
  // A strong ETag lets the browser keep it and confirm with a bodyless 304 instead of
  // downloading the whole file every time the editor opens.
  const etag = `"${createHash("sha1").update(buffer).digest("hex")}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": imageRow.mime_type ?? "image/png",
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "private, max-age=0, must-revalidate",
      ETag: etag,
    },
  });
}

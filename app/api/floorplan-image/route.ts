import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { loadApprovedPlan } from "@/lib/ownership";
import { requireSession } from "@/lib/server-auth";
import { BUCKET_NAME, getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

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
  const imageIdParam = searchParams.get("imageId");
  const imagePathParam = searchParams.get("imagePath");

  if (!imageIdParam && !imagePathParam) {
    return NextResponse.json({ message: "Ingen bild vald." }, { status: 400 });
  }

  const plan = await loadApprovedPlan(adminSupabase, session, {
    imageId: imageIdParam ? Number(imageIdParam) : null,
    imagePath: imagePathParam,
  });
  if (!plan.ok) {
    return plan.response;
  }
  const imageRow = plan.row;

  const { data: fileData, error: downloadError } = await adminSupabase.storage
    .from(BUCKET_NAME)
    .download(imageRow.file_path);

  if (downloadError || !fileData) {
    console.error("Failed to download floor plan image", downloadError);
    return NextResponse.json({ message: "Kunde inte ladda planritningsbilden." }, { status: 500 });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());

  // The editor's background: the plan's original image, which finishing never replaces. A strong ETag lets the browser keep it and confirm with a bodyless 304 instead of
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

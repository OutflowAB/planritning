import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { createThumbnail, thumbnailPath } from "@/lib/image/thumbnail";
import { requireRole } from "@/lib/server-auth";
import {
  BUCKET_NAME,
  getAdminSupabase,
  serverConfigMissingResponse,
  UPLOADS_TABLE,
} from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * GET /api/image?id=<row id>&variant=full|thumb&v=<version>
 *
 * Serves image bytes behind the session, with cache headers that let the browser keep them.
 *
 * Because `v` (the storage eTag) is part of the URL, a republished file gets a new URL and the
 * old one can be cached as immutable without ever going stale. Thumbnails are stored
 * derivatives keyed by the same version, generated on first request for files that predate
 * this route and then served from storage from then on.
 */

const IMMUTABLE = "private, max-age=31536000, immutable";
/** For requests without a version: the browser may keep it, but has to ask again. */
const REVALIDATE = "private, max-age=0, must-revalidate";

function etagFor(buffer: Buffer) {
  return `"${createHash("sha1").update(buffer).digest("hex")}"`;
}

function imageResponse(request: Request, buffer: Buffer, contentType: string, versioned: boolean) {
  const etag = etagFor(buffer);
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": versioned ? IMMUTABLE : REVALIDATE,
      ETag: etag,
    },
  });
}

export async function GET(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  const supabase = getAdminSupabase();
  if (!supabase) {
    return serverConfigMissingResponse();
  }

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  const variant = searchParams.get("variant") === "thumb" ? "thumb" : "full";
  const version = searchParams.get("v");

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from(UPLOADS_TABLE)
    .select("id, file_path, mime_type, file_size")
    .eq("id", id)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ message: "Bilden finns inte längre." }, { status: 404 });
  }

  const bucket = supabase.storage.from(BUCKET_NAME);

  if (variant === "thumb") {
    const thumbPath = thumbnailPath(row.file_path, version ?? String(row.file_size));

    const { data: existing } = await bucket.download(thumbPath);
    if (existing) {
      return imageResponse(request, Buffer.from(await existing.arrayBuffer()), "image/webp", true);
    }

    const { data: original, error: downloadError } = await bucket.download(row.file_path);
    if (downloadError || !original) {
      return NextResponse.json({ message: "Bildfilen saknas i lagringen." }, { status: 404 });
    }

    const thumbnail = await createThumbnail(Buffer.from(await original.arrayBuffer()));
    // Best effort: a failed write costs another resize next time, nothing worse.
    void bucket.upload(thumbPath, thumbnail, { contentType: "image/webp", upsert: true });

    return imageResponse(request, thumbnail, "image/webp", true);
  }

  const { data: file, error: downloadError } = await bucket.download(row.file_path);
  if (downloadError || !file) {
    return NextResponse.json({ message: "Bildfilen saknas i lagringen." }, { status: 404 });
  }

  return imageResponse(
    request,
    Buffer.from(await file.arrayBuffer()),
    row.mime_type ?? "image/png",
    Boolean(version),
  );
}

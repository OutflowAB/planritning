import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { createThumbnail, thumbnailPath } from "@/lib/image/thumbnail";
import { loadOwnedImage } from "@/lib/ownership";
import { requireSession } from "@/lib/server-auth";
import { BUCKET_NAME, getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * GET /api/image?id=<row id>&variant=full|thumb|source&v=<version>
 *
 * `full` and `thumb` show a plan as last finished; `source` is the image it was made from,
 * which the editor draws on.
 *
 * Serves image bytes behind the session, with cache headers that let the browser keep them.
 *
 * Because `v` (the storage eTag) is part of the URL, a republished file gets a new URL and the
 * old one can be cached as immutable without ever going stale. Thumbnails are stored
 * derivatives keyed by the same version, generated on first request for files that predate
 * this route and then served from storage from then on.
 */

const IMMUTABLE = "private, max-age=31536000, immutable";
const SERVABLE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
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
      // Only image types are ever sent, and never sniffed into anything else.
      "Content-Type": SERVABLE_TYPES.has(contentType) ? contentType : "application/octet-stream",
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": versioned ? IMMUTABLE : REVALIDATE,
      ETag: etag,
    },
  });
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session.ok) {
    return session.response;
  }

  const supabase = getAdminSupabase();
  if (!supabase) {
    return serverConfigMissingResponse();
  }

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  const variantParam = searchParams.get("variant");
  const variant = variantParam === "thumb" || variantParam === "source" ? variantParam : "full";
  const version = searchParams.get("v");

  const owned = await loadOwnedImage(supabase, session, id);
  if (!owned.ok) {
    return owned.response;
  }
  const row = owned.row;
  if (row.purged_at) {
    return NextResponse.json({ message: "Originalet raderades efter 90 dagar." }, { status: 410 });
  }

  const bucket = supabase.storage.from(BUCKET_NAME);
  // A finished plan is its published image; the stored original stays untouched.
  const shownPath = variant === "source" ? row.file_path : (row.published_path ?? row.file_path);

  if (variant === "thumb") {
    const thumbPath = thumbnailPath(shownPath, version ?? row.published_at ?? String(row.file_size));

    const { data: existing } = await bucket.download(thumbPath);
    if (existing) {
      return imageResponse(request, Buffer.from(await existing.arrayBuffer()), "image/webp", true);
    }

    const { data: original, error: downloadError } = await bucket.download(shownPath);
    if (downloadError || !original) {
      return NextResponse.json({ message: "Bildfilen saknas i lagringen." }, { status: 404 });
    }

    const thumbnail = await createThumbnail(Buffer.from(await original.arrayBuffer()));
    // Best effort: a failed write costs another resize next time, nothing worse.
    void bucket.upload(thumbPath, thumbnail, { contentType: "image/webp", upsert: true });

    return imageResponse(request, thumbnail, "image/webp", true);
  }

  const { data: file, error: downloadError } = await bucket.download(shownPath);
  if (downloadError || !file) {
    return NextResponse.json({ message: "Bildfilen saknas i lagringen." }, { status: 404 });
  }

  return imageResponse(
    request,
    Buffer.from(await file.arrayBuffer()),
    shownPath === row.file_path ? (row.mime_type ?? "image/png") : "image/png",
    Boolean(version),
  );
}

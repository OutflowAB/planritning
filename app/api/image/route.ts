import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { renderDocumentPreview } from "@/lib/floorplan/preview";
import type { FloorplanDocument } from "@/lib/floorplan/types";
import { createBlankFloorplanImage } from "@/lib/image/blank-floorplan";
import { createThumbnail, thumbnailPath } from "@/lib/image/thumbnail";
import { requireRole } from "@/lib/server-auth";
import {
  BLANK_FLOORPLAN_PREFIX,
  BUCKET_NAME,
  DOCUMENTS_TABLE,
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

// The untouched sheet a blank or scanned plan starts as; rendered once.
let blankPage: ReturnType<typeof createBlankFloorplanImage> | null = null;
function getBlankPage() {
  blankPage ??= createBlankFloorplanImage().catch((error) => {
    blankPage = null;
    throw error;
  });
  return blankPage;
}

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

  // A blank or scanned plan not yet finished is only its document on a blank page, so the page
  // alone would look empty; it is drawn from the document as it is now. Finishing replaces the
  // page with the finished plan, which is then shown as it is.
  const drawDraft = async (page: Buffer): Promise<Buffer | null> => {
    if (!row.file_path.startsWith(BLANK_FLOORPLAN_PREFIX)) return null;
    if (!page.equals((await getBlankPage()).output)) return null;
    const { data: saved } = await supabase
      .from(DOCUMENTS_TABLE)
      .select("document")
      .eq("image_id", row.id)
      .maybeSingle<{ document: FloorplanDocument | null }>();
    return saved?.document?.objects?.length ? renderDocumentPreview(page, saved.document) : null;
  };

  if (variant === "thumb") {
    // The version of a blank or scanned plan follows its saves (see /api/images), so a thumbnail
    // stored under it is never stale.
    const thumbPath = thumbnailPath(row.file_path, version ?? String(row.file_size));

    const { data: existing } = await bucket.download(thumbPath);
    if (existing) {
      return imageResponse(request, Buffer.from(await existing.arrayBuffer()), "image/webp", true);
    }

    const { data: original, error: downloadError } = await bucket.download(row.file_path);
    if (downloadError || !original) {
      return NextResponse.json({ message: "Bildfilen saknas i lagringen." }, { status: 404 });
    }

    const page = Buffer.from(await original.arrayBuffer());
    // shortcut: every save leaves one more stored thumbnail of a draft (removed with the plan);
    // prune older ones if storage of thumbnails ever matters.
    const thumbnail = await createThumbnail((await drawDraft(page)) ?? page);
    // Best effort: a failed write costs another resize next time, nothing worse.
    void bucket.upload(thumbPath, thumbnail, { contentType: "image/webp", upsert: true });

    return imageResponse(request, thumbnail, "image/webp", true);
  }

  const { data: file, error: downloadError } = await bucket.download(row.file_path);
  if (downloadError || !file) {
    return NextResponse.json({ message: "Bildfilen saknas i lagringen." }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (variant === "full") {
    const drawn = await drawDraft(bytes);
    if (drawn) return imageResponse(request, drawn, "image/png", Boolean(version));
  }

  return imageResponse(
    request,
    bytes,
    row.mime_type ?? "image/png",
    Boolean(version),
  );
}

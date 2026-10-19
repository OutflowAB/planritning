import { NextResponse } from "next/server";

import { parseScanPlan, scanToFloorplanDocument, type ScanPlan } from "@/lib/floorplan/scan-import";
import { FLOORPLAN_DOCUMENT_VERSION, type FloorplanDocument } from "@/lib/floorplan/types";
import { createBlankFloorplanImage } from "@/lib/image/blank-floorplan";
import { renderDocumentPreview } from "@/lib/floorplan/preview";
import { createThumbnail, thumbnailPath } from "@/lib/image/thumbnail";
import { imageDownloadBaseName, imageDownloadFileName } from "@/lib/image-naming";
import { readJsonCapped } from "@/lib/http";
import { requireRole } from "@/lib/server-auth";
import {
  BLANK_FLOORPLAN_PREFIX,
  BUCKET_NAME,
  DOCUMENTS_TABLE,
  GENERATED_PREFIX,
  getAdminSupabase,
  normaliseEtag,
  REVIEWS_TABLE,
  serverConfigMissingResponse,
  UPLOADS_TABLE,
} from "@/lib/supabase-server";

export const runtime = "nodejs";

const PROFILES_TABLE = "profiles";

// A real scan is a few kilobytes; this only stops someone posting something absurd.
const MAX_BODY_BYTES = 2_000_000;

// The canvas never changes while the server runs, so it is rendered once.
let blankImage: ReturnType<typeof createBlankFloorplanImage> | null = null;
function getBlankImage() {
  blankImage ??= createBlankFloorplanImage().catch((error) => {
    blankImage = null;
    throw error;
  });
  return blankImage;
}

/** The oldest active admin in the shared accounts table, or null before that table exists. */
async function defaultOwnerId(supabase: NonNullable<ReturnType<typeof getAdminSupabase>>) {
  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .select("id")
    .eq("role", "admin")
    .eq("disabled", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return error ? null : (data?.id ?? null);
}

/** Postgres "undefined column", or PostgREST not knowing the column. */
function isMissingColumn(error: { code?: string }) {
  return error.code === "42703" || error.code === "PGRST204";
}

/**
 * GET /api/blank-floorplan — the untouched canvas. Blank plans keep their editable document
 * after Slutför, so the editor and export draw it on this rather than on the flattened image.
 */
export async function GET() {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  const { output } = await getBlankImage();
  return new NextResponse(new Uint8Array(output), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
  });
}

/**
 * POST /api/blank-floorplan — starts a plan with nothing on it, or with a scan drawn on it when
 * the body is `{ "scan": ScanPlan }`. It is stored like an approved generation, so it opens in
 * Verktyg and is saved, listed and exported like any other plan. It is listed under Skannare
 * until it is saved to Planritningar from Verktyg, like a generation.
 */
export async function POST(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  const supabase = getAdminSupabase();
  if (!supabase) {
    return serverConfigMissingResponse();
  }

  let scan: ScanPlan | null = null;
  const read = await readJsonCapped<{ scan?: unknown }>(request, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.response.status === 413
      ? NextResponse.json({ message: "Skanningsfilen är för stor." }, { status: 413 })
      : NextResponse.json({ message: "Skanningsfilen är inte giltig JSON." }, { status: 400 });
  }
  if (read.data?.scan !== undefined) {
    const parsed = parseScanPlan(read.data.scan);
    if (!parsed.ok) {
      return NextResponse.json({ message: parsed.message }, { status: 400 });
    }
    scan = parsed.scan;
  }

  const blank = await getBlankImage();
  const fileName = `${Date.now()}-${crypto.randomUUID()}.png`;
  const storagePath = `${BLANK_FLOORPLAN_PREFIX}${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, blank.output, { upsert: false, contentType: "image/png" });

  if (uploadError) {
    console.error("Failed to store blank floor plan", uploadError);
    return NextResponse.json({ message: "Kunde inte skapa planritningen." }, { status: 500 });
  }

  const row = {
    file_name: "planritning.png",
    file_path: storagePath,
    file_size: blank.output.byteLength,
    mime_type: "image/png",
  };
  // The database is shared with the accounts version of the app (planritning2.0). Once its
  // upgrade has run, every plan needs an owner; this app has no accounts, so a scan belongs to
  // the oldest admin, the same rule that upgrade uses for existing plans. Before it has run the
  // columns do not exist, and the row is stored without them.
  const ownerId = await defaultOwnerId(supabase);
  let { data: inserted, error: insertError } = ownerId
    ? await supabase
        .from(UPLOADS_TABLE)
        .insert({ ...row, owner_id: ownerId, engine: scan ? "scan" : "blank" })
        .select("id")
        .single()
    : { data: null, error: null };
  if (!ownerId || (insertError && isMissingColumn(insertError))) {
    ({ data: inserted, error: insertError } = await supabase
      .from(UPLOADS_TABLE)
      .insert(row)
      .select("id")
      .single());
  }

  if (insertError || !inserted?.id) {
    await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
    console.error("Failed to store blank floor plan metadata", insertError);
    return NextResponse.json({ message: "Kunde inte skapa planritningen." }, { status: 500 });
  }

  const now = new Date().toISOString();
  const meta = {
    imageId: inserted.id,
    imagePath: storagePath,
    fileName: imageDownloadBaseName(inserted.id),
    createdAt: now,
    updatedAt: now,
  };
  // Even an empty plan gets a document, so it knows its drawing area (needed to rotate it).
  const document: FloorplanDocument = scan
    ? scanToFloorplanDocument(scan, blank, meta)
    : {
        version: FLOORPLAN_DOCUMENT_VERSION,
        canvas: { width: blank.canvasWidth, height: blank.canvasHeight },
        meta,
        drawingArea: { x: blank.imageX, y: blank.imageY, width: blank.imageWidth, height: blank.imageHeight },
        objects: [],
      };

  // Named after its id like every generation, and approved: there is nothing to review.
  const results = await Promise.all([
    supabase
      .from(UPLOADS_TABLE)
      .update({ file_name: imageDownloadFileName(inserted.id, "png") })
      .eq("id", inserted.id),
    supabase
      .from(REVIEWS_TABLE)
      .insert({ image_id: inserted.id, file_path: storagePath, decision: "approved" }),
    supabase
      .from(DOCUMENTS_TABLE)
      .insert({ image_id: inserted.id, file_path: storagePath, document, updated_at: now }),
  ]);
  const finishError = results.find((result) => result.error)?.error;

  if (finishError) {
    // Its review and document go with it.
    await supabase.from(UPLOADS_TABLE).delete().eq("id", inserted.id);
    await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
    console.error("Failed to finish blank floor plan", finishError);
    return NextResponse.json({ message: "Kunde inte skapa planritningen." }, { status: 500 });
  }

  // The document as created is kept apart, for "Original" to return to. Best-effort: the column
  // arrives with database/2026-10-19-lidar-scans.sql.
  const { error: sourceError } = await supabase
    .from(DOCUMENTS_TABLE)
    .update({ source_document: document })
    .eq("image_id", inserted.id)
    .eq("file_path", storagePath);
  if (sourceError) {
    console.warn("Could not keep the scan's original document", sourceError.message);
  }

  try {
    // The page itself is blank (the plan is its document), so a scan would look empty in the list.
    const thumbnailSource = document.objects.length > 0 ? await renderDocumentPreview(blank.output, document) : blank.output;
    const { data: listed } = await supabase.storage
      .from(BUCKET_NAME)
      .list(GENERATED_PREFIX.replace(/\/$/, ""), { search: storagePath.slice(GENERATED_PREFIX.length), limit: 1 });
    const version = normaliseEtag((listed?.[0]?.metadata as { eTag?: unknown } | null)?.eTag);
    await supabase.storage
      .from(BUCKET_NAME)
      .upload(thumbnailPath(storagePath, version ?? String(blank.output.byteLength)), await createThumbnail(thumbnailSource), {
        contentType: "image/webp",
        upsert: true,
      });
  } catch (thumbnailError) {
    console.error("Thumbnail generation failed for blank floor plan", thumbnailError);
  }

  return NextResponse.json({ image: { id: inserted.id, file_path: storagePath } });
}

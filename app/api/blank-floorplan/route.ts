import { NextResponse } from "next/server";

import { parseScanPlan, scanToFloorplanDocument, type ScanPlan } from "@/lib/floorplan/scan-import";
import { FLOORPLAN_DOCUMENT_VERSION, type FloorplanDocument } from "@/lib/floorplan/types";
import { createBlankFloorplanImage } from "@/lib/image/blank-floorplan";
import { renderDocumentPreview } from "@/lib/floorplan/preview";
import { createThumbnail, thumbnailPath } from "@/lib/image/thumbnail";
import { imageDownloadBaseName, imageDownloadFileName } from "@/lib/image-naming";
import { readJsonCapped } from "@/lib/http";
import { requireSession } from "@/lib/server-auth";
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

/**
 * GET /api/blank-floorplan — the untouched canvas. Blank plans keep their editable document
 * after Slutför, so the editor and export draw it on this rather than on the flattened image.
 */
export async function GET() {
  const session = await requireSession();
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
 * Verktyg and is saved, listed and exported like any other plan.
 */
export async function POST(request: Request) {
  const session = await requireSession();
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

  const { data: inserted, error: insertError } = await supabase
    .from(UPLOADS_TABLE)
    .insert({
      file_name: "planritning.png",
      file_path: storagePath,
      file_size: blank.output.byteLength,
      mime_type: "image/png",
      owner_id: session.userId,
      engine: scan ? "scan" : "blank",
      // In the library from the start, so a plan left before it is finished can be found.
      saved_at: new Date().toISOString(),
    })
    .select("id")
    .single();

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
      // The document as created is kept apart, for "Original" to return to.
      .insert({ image_id: inserted.id, file_path: storagePath, document, source_document: document, updated_at: now }),
  ]);
  const finishError = results.find((result) => result.error)?.error;

  if (finishError) {
    // Its review and document go with it.
    await supabase.from(UPLOADS_TABLE).delete().eq("id", inserted.id);
    await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
    console.error("Failed to finish blank floor plan", finishError);
    return NextResponse.json({ message: "Kunde inte skapa planritningen." }, { status: 500 });
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

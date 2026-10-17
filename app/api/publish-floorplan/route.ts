import { NextResponse } from "next/server";

import { planPriceOre } from "@/lib/billing";
import { readJsonCapped } from "@/lib/http";
import { loadApprovedPlan } from "@/lib/ownership";
import { requireSession } from "@/lib/server-auth";
import {
  BILLING_EVENTS_TABLE,
  BUCKET_NAME,
  DOCUMENTS_TABLE,
  getAdminSupabase,
  PUBLISHED_PREFIX,
  serverConfigMissingResponse,
  UPLOADS_TABLE,
} from "@/lib/supabase-server";

const MAX_PUBLISH_BYTES = Math.floor(4.5 * 1024 * 1024);

type PublishBody = {
  imageId?: number;
  imagePath?: string;
  pngDataUrl?: string;
};

function parsePngDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match?.[1]) {
    return null;
  }

  return Buffer.from(match[1], "base64");
}

/**
 * "Slutför": stores the finished image beside the original, never over it, keeps the editable
 * document (and a copy of it as finished, for downloads), and bills the plan. Every finish is
 * billed, a re-finish too.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  // The finished image arrives as base64; the host accepts at most 4.5 MB per request anyway.
  const read = await readJsonCapped<PublishBody>(request, MAX_PUBLISH_BYTES);
  if (!read.ok) {
    return read.response;
  }
  const body = read.data;
  const imageId = typeof body.imageId === "number" ? body.imageId : Number.NaN;
  const filePath = body.imagePath?.trim() ?? "";
  const pngBuffer = body.pngDataUrl ? parsePngDataUrl(body.pngDataUrl) : null;

  if (!pngBuffer || pngBuffer.byteLength === 0) {
    return NextResponse.json({ message: "Ogiltig bilddata." }, { status: 400 });
  }

  const plan = await loadApprovedPlan(adminSupabase, session, { imageId, imagePath: filePath }, { forChange: true });
  if (!plan.ok) {
    return plan.response;
  }

  const publishedPath = `${PUBLISHED_PREFIX}${imageId}.png`;
  const { error: uploadError } = await adminSupabase.storage.from(BUCKET_NAME).upload(publishedPath, pngBuffer, {
    upsert: true,
    contentType: "image/png",
  });
  if (uploadError) {
    console.error("Failed to publish floor plan image", uploadError);
    return NextResponse.json({ message: "Kunde inte spara den färdiga planritningen." }, { status: 500 });
  }

  const publishedAt = new Date().toISOString();
  const { error: metadataError } = await adminSupabase
    .from(UPLOADS_TABLE)
    .update({ published_path: publishedPath, published_at: publishedAt, saved_at: plan.row.saved_at ?? publishedAt })
    .eq("id", imageId);
  if (metadataError) {
    console.error("Failed to update published image metadata", metadataError);
    return NextResponse.json({ message: "Kunde inte uppdatera bildmetadata." }, { status: 500 });
  }

  // Downloads are made from the plan as finished, so later edits are not delivered unbilled.
  const { data: documentRow } = await adminSupabase
    .from(DOCUMENTS_TABLE)
    .select("document")
    .eq("image_id", imageId)
    .eq("file_path", filePath)
    .maybeSingle();
  if (documentRow?.document) {
    await adminSupabase
      .from(DOCUMENTS_TABLE)
      .update({ published_document: documentRow.document })
      .eq("image_id", imageId)
      .eq("file_path", filePath);
  }

  const { error: billingError } = await adminSupabase.from(BILLING_EVENTS_TABLE).insert({
    owner_id: session.userId,
    image_id: imageId,
    price_ore: planPriceOre(),
    address: plan.row.address,
    floor_label: plan.row.floor_label,
  });
  if (billingError) {
    console.error("Failed to record billing event", billingError);
    return NextResponse.json({ message: "Kunde inte registrera den färdiga planen." }, { status: 500 });
  }

  return NextResponse.json({ success: true, publishedAt });
}

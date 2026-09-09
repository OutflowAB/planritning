import { NextResponse } from "next/server";

import { imageDownloadFileName, imageExtensionFromMimeType } from "@/lib/image-naming";
import { assertDecodableImage, createThumbnail, thumbnailPath } from "@/lib/image/thumbnail";
import { requireRole } from "@/lib/server-auth";
import {
  BUCKET_NAME,
  getAdminSupabase,
  normaliseEtag,
  serverConfigMissingResponse,
  UPLOADED_IMAGE_COLUMNS,
  UPLOADS_PREFIX,
  UPLOADS_TABLE,
  type UploadedImageRow,
} from "@/lib/supabase-server";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

/**
 * POST /api/upload — multipart with a `file` field.
 *
 * Uploads used to go straight from the browser to Supabase with the public key, which is why
 * that key had to be allowed to write. Doing it here also means the file is actually decoded
 * before it is accepted, and the thumbnail is made once, now, rather than on first view.
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

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ message: "Ingen fil skickades." }, { status: 400 });
  }
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { message: "Filen måste vara en bild i PNG, JPEG eller WebP." },
      { status: 415 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ message: "Filen får vara högst 25 MB." }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    await assertDecodableImage(buffer);
  } catch {
    return NextResponse.json({ message: "Filen gick inte att läsa som bild." }, { status: 415 });
  }

  const extension = imageExtensionFromMimeType(file.type) ?? "jpg";
  const storagePath = `${UPLOADS_PREFIX}${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const bucket = supabase.storage.from(BUCKET_NAME);

  const { error: uploadError } = await bucket.upload(storagePath, buffer, {
    upsert: false,
    contentType: file.type,
  });
  if (uploadError) {
    console.error("Failed to store upload", uploadError);
    return NextResponse.json({ message: "Kunde inte spara filen." }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from(UPLOADS_TABLE)
    .insert({
      file_name: file.name,
      file_path: storagePath,
      file_size: buffer.byteLength,
      mime_type: file.type,
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    await bucket.remove([storagePath]);
    console.error("Failed to store upload metadata", insertError);
    return NextResponse.json({ message: "Kunde inte spara bildens metadata." }, { status: 500 });
  }

  const { data: row, error: renameError } = await supabase
    .from(UPLOADS_TABLE)
    .update({ file_name: imageDownloadFileName(inserted.id, extension) })
    .eq("id", inserted.id)
    .select(UPLOADED_IMAGE_COLUMNS)
    .single();

  if (renameError || !row) {
    await bucket.remove([storagePath]);
    await supabase.from(UPLOADS_TABLE).delete().eq("id", inserted.id);
    console.error("Failed to finalise upload metadata", renameError);
    return NextResponse.json({ message: "Kunde inte spara bildens metadata." }, { status: 500 });
  }

  // Version for the image URL, and the thumbnail made while the bytes are already here.
  let version: string | null = null;
  try {
    const { data: listed } = await bucket.list(UPLOADS_PREFIX.replace(/\/$/, ""), {
      search: storagePath.slice(UPLOADS_PREFIX.length),
      limit: 1,
    });
    version = normaliseEtag((listed?.[0]?.metadata as { eTag?: unknown } | null)?.eTag);

    const thumbnail = await createThumbnail(buffer);
    await bucket.upload(thumbnailPath(storagePath, version ?? String(buffer.byteLength)), thumbnail, {
      contentType: "image/webp",
      upsert: true,
    });
  } catch (error) {
    // The upload has succeeded; a missing thumbnail is made on first view instead.
    console.error("Thumbnail generation failed after upload", error);
  }

  return NextResponse.json({ item: { ...(row as UploadedImageRow), version } });
}

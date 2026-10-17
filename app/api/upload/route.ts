import { NextResponse } from "next/server";

import { imageDownloadFileName } from "@/lib/image-naming";
import { createThumbnail, thumbnailPath } from "@/lib/image/thumbnail";
import { validateImageUpload } from "@/lib/image/validate-upload";
import { requireSession } from "@/lib/server-auth";
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

/**
 * POST /api/upload — multipart with a `file` field.
 *
 * Uploads used to go straight from the browser to Supabase with the public key, which is why
 * that key had to be allowed to write. Doing it here also means the file is actually decoded
 * before it is accepted, and the thumbnail is made once, now, rather than on first view.
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

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ message: "Ingen fil skickades." }, { status: 400 });
  }
  const upload = await validateImageUpload(file);
  if (!upload.ok) {
    return NextResponse.json({ message: upload.message }, { status: upload.status });
  }
  const { buffer, extension, mimeType } = upload;
  const storagePath = `${UPLOADS_PREFIX}${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const bucket = supabase.storage.from(BUCKET_NAME);

  const { error: uploadError } = await bucket.upload(storagePath, buffer, {
    upsert: false,
    contentType: mimeType,
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
      mime_type: mimeType,
      owner_id: session.userId,
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

  return NextResponse.json({ item: { ...(row as unknown as UploadedImageRow), version } });
}

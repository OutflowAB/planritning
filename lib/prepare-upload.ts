"use client";

/** Kept under the 4.5 MB the host accepts per request, with room for the form around it. */
const UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
/** More detail than any floor plan needs; the AI works at 2560 px. */
const MAX_EDGE_PX = 4096;

/**
 * A phone photo shrunk to something the server accepts: at most 4096 px on its longest side
 * and under 4 MB, as JPEG. Files already small enough, and anything that is not a bitmap
 * image, are sent as they are (the server decides about those).
 */
export async function prepareImageUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return file;
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return file;
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (file.size <= UPLOAD_LIMIT_BYTES && longest <= MAX_EDGE_PX) {
      return file;
    }

    let scale = Math.min(1, MAX_EDGE_PX / longest);
    let quality = 0.9;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      // JPEG has no transparency: a white page behind the drawing.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= UPLOAD_LIMIT_BYTES) {
        const name = file.name.replace(/\.[^.]+$/, "") || "planritning";
        return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
      }
      // Lower the quality a little first, then the size.
      if (quality > 0.7) quality -= 0.1;
      else scale *= 0.8;
    }
    return file;
  } finally {
    bitmap.close();
  }
}

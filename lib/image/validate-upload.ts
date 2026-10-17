import sharp from "sharp";

/**
 * Vercel refuses request bodies over 4.5 MB, so uploads are shrunk in the browser first (see
 * lib/prepare-upload.ts) and anything larger is refused here with a clear message.
 */
export const MAX_UPLOAD_BYTES = Math.floor(4.5 * 1024 * 1024);

/** The raster formats a floor plan arrives in. SVG and everything else is refused. */
const ACCEPTED_FORMATS: Record<string, { mimeType: string; extension: string }> = {
  png: { mimeType: "image/png", extension: "png" },
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  webp: { mimeType: "image/webp", extension: "webp" },
};

export type ValidatedUpload =
  | { ok: true; buffer: Buffer; mimeType: string; extension: string }
  | { ok: false; status: number; message: string };

/**
 * An uploaded image, checked by what the bytes are rather than what the browser says: the
 * stored type is the one sharp detects, so a file can never be served back as something else.
 */
export async function validateImageUpload(file: File): Promise<ValidatedUpload> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, message: "Bilden är för stor. Den får vara högst 4,5 MB." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let format: string | undefined;
  try {
    const metadata = await sharp(buffer).metadata();
    format = metadata.width && metadata.height ? metadata.format : undefined;
  } catch {
    format = undefined;
  }

  const accepted = format ? ACCEPTED_FORMATS[format] : undefined;
  if (!accepted) {
    return { ok: false, status: 415, message: "Filen måste vara en bild i PNG, JPEG eller WebP." };
  }
  return { ok: true, buffer, ...accepted };
}

import sharp from "sharp";

import { THUMBNAILS_PREFIX } from "@/lib/supabase-server";

/**
 * Thumbnails are computed once, when a file is uploaded or generated, and stored next to it.
 *
 * Before this, every thumbnail went through the Next image optimiser from a signed URL. The
 * token in that URL changed every hour, so the optimiser's cache key changed with it and every
 * thumbnail was fetched from storage and re-encoded again — a cost that grew with page views.
 * A stored derivative costs one resize per image, ever.
 */

/** Wide enough for a three-column grid at 2x on a 1440px screen; cards render at ~330px. */
export const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_QUALITY = 80;

export function thumbnailPath(filePath: string, version: string): string {
  const baseName = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image";
  const versionTag = version.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "0";
  return `${THUMBNAILS_PREFIX}${baseName}-${versionTag}.webp`;
}

export async function createThumbnail(originalBuffer: Buffer): Promise<Buffer> {
  return sharp(originalBuffer)
    .rotate()
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();
}

/**
 * Rejects anything that is not a decodable raster image. A file can claim `image/png` in its
 * MIME type and still be something else; sharp has to actually parse the header.
 */
export async function assertDecodableImage(buffer: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Filen är inte en giltig bild.");
  }
  return { width: metadata.width, height: metadata.height };
}

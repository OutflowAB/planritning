"use client";

/**
 * Warms the browser cache for an image the user is likely to open next — typically the full
 * variant of a thumbnail they are hovering. Because image URLs are versioned and immutable,
 * a prefetch is never wasted on a stale file, and each URL is requested at most once per
 * page lifetime so hovering back and forth costs nothing extra.
 */

const requested = new Set<string>();

export function prefetchImage(url: string | null | undefined) {
  if (!url || typeof window === "undefined" || requested.has(url)) {
    return;
  }

  // Respect data-saver and slow connections; a prefetch there is bandwidth the user did not
  // ask for.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (connection?.saveData || connection?.effectiveType === "2g") {
    return;
  }

  requested.add(url);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
}

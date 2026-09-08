import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared preview-URL cache for the image lists.
 *
 * Supabase signed URLs are valid for one hour, so re-signing every path on every mount makes
 * images arrive a round trip late on pages the user has already visited. Caching them in
 * localStorage lets a revisit paint immediately, as long as two things hold: entries are
 * dropped before the token actually expires, and nothing else stores a copy of a URL that
 * this cache has already discarded.
 */

const SIGNED_URL_TTL_SECONDS = 3600;

/** Kept below the token's own hour so a cached URL is never handed out about to die. */
const PREVIEW_CACHE_TTL_MS = 55 * 60 * 1000;

export type PreviewCacheEntry = {
  url: string;
  expiresAt: number;
};

export type PreviewCache = Map<string, PreviewCacheEntry>;

export function readPreviewCache(cacheKey: string): PreviewCache {
  if (typeof window === "undefined") {
    return new Map();
  }

  const rawCache = window.localStorage.getItem(cacheKey);
  if (!rawCache) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(rawCache) as Record<string, PreviewCacheEntry>;
    const now = Date.now();
    const map: PreviewCache = new Map();

    Object.entries(parsed).forEach(([path, entry]) => {
      if (entry?.url && typeof entry.expiresAt === "number" && entry.expiresAt > now) {
        map.set(path, entry);
      }
    });

    return map;
  } catch {
    return new Map();
  }
}

export function writePreviewCache(cacheKey: string, cache: PreviewCache) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(cacheKey, JSON.stringify(Object.fromEntries(cache)));
}

/**
 * Re-resolves the preview URLs on rows restored from a list cache.
 *
 * A list cache stores whole rows, preview URL included, but it expires on its own schedule.
 * Reading a row back can therefore hand out a signed URL that died in the meantime, which is
 * what makes thumbnails render as broken images. Checking every URL against the expiry-aware
 * preview cache keeps only the ones still known to be good.
 */
export function withFreshPreviewUrls<T extends { file_path: string; preview_url?: string | null }>(
  rows: T[],
  cacheKey: string,
): T[] {
  const cache = readPreviewCache(cacheKey);

  return rows.map((row) => {
    const cached = cache.get(row.file_path);
    return cached ? { ...row, preview_url: cached.url } : { ...row, preview_url: null };
  });
}

/**
 * Returns a preview URL per path, signing only the paths that are not cached, and prunes
 * entries for paths that no longer exist.
 */
export async function resolvePreviewUrls(
  supabase: SupabaseClient,
  bucketName: string,
  paths: string[],
  cacheKey: string,
  { forceRefresh = false }: { forceRefresh?: boolean } = {},
): Promise<Map<string, string>> {
  const previewByPath = new Map<string, string>();
  const cache = readPreviewCache(cacheKey);
  const pathsToSign: string[] = [];

  paths.forEach((path) => {
    const cached = forceRefresh ? undefined : cache.get(path);
    if (cached) {
      previewByPath.set(path, cached.url);
      return;
    }

    pathsToSign.push(path);
  });

  if (pathsToSign.length > 0) {
    const { data: signedData } = await supabase.storage
      .from(bucketName)
      .createSignedUrls(pathsToSign, SIGNED_URL_TTL_SECONDS);

    signedData?.forEach((item, index) => {
      const path = pathsToSign[index];
      if (item?.signedUrl && path) {
        previewByPath.set(path, item.signedUrl);
        cache.set(path, {
          url: item.signedUrl,
          expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
        });
      }
    });
  }

  const validPaths = new Set(paths);
  Array.from(cache.keys()).forEach((path) => {
    if (!validPaths.has(path)) {
      cache.delete(path);
    }
  });

  writePreviewCache(cacheKey, cache);
  return previewByPath;
}

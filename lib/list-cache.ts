"use client";

/**
 * The one list cache. Planritningar and Uppladdningar each carried their own copy of this —
 * same shape, same bugs, fixed one at a time. Entries live in sessionStorage so a revisit in
 * the same tab paints instantly, and expire so a new tab starts clean.
 */

export const LIST_CACHE_TTL_MS = 15 * 60 * 1000;

type ListCachePayload<T> = {
  rows: T[];
  expiresAt: number;
};

export function readListCache<T>(key: string): T[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<ListCachePayload<T>>;
    if (
      !Array.isArray(parsed.rows) ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    return parsed.rows;
  } catch {
    return null;
  }
}

export function writeListCache<T>(key: string, rows: T[], ttlMs = LIST_CACHE_TTL_MS) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: ListCachePayload<T> = { rows, expiresAt: Date.now() + ttlMs };
  try {
    window.sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Quota. The list is simply not cached this time; the next visit fetches it fresh.
  }
}

export function clearListCache(key: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(key);
}

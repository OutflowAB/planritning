"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { describeError, isAbortError } from "@/lib/api-client";
import { readListCache, writeListCache } from "@/lib/list-cache";

/**
 * Stale-while-revalidate for a list.
 *
 * On mount the cached rows are painted synchronously — no spinner, no empty frame — and a
 * fetch runs behind them. Every page that shows a list of images used to implement this
 * dance by hand, each with a slightly different bug: one never revalidated, one flashed a
 * skeleton over cached content, one had no cache at all.
 *
 * The fetcher receives an AbortSignal that fires when the component unmounts or `reload` is
 * called again, so a navigation mid-request neither leaks a state update nor shows an error.
 */

export type CachedListState<T> = {
  items: T[];
  /** No cached rows and the first fetch has not finished. */
  isLoading: boolean;
  /** Cached rows are on screen and a fetch is running behind them. */
  isRefreshing: boolean;
  error: string | null;
  reload: () => void;
};

export function useCachedList<T>(
  cacheKey: string,
  fetcher: (signal: AbortSignal) => Promise<T[]>,
  errorFallback = "Kunde inte hämta listan.",
): CachedListState<T> {
  const [cached] = useState(() => readListCache<T>(cacheKey));
  const [items, setItems] = useState<T[]>(() => cached ?? []);
  const [isLoading, setIsLoading] = useState(cached === null);
  const [isRefreshing, setIsRefreshing] = useState(cached !== null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    const hasCache = readListCache<T>(cacheKey) !== null;

    // Deferred so the state updates happen after the first paint, never during it.
    const timer = window.setTimeout(() => {
      setError(null);
      if (hasCache) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      fetcherRef
        .current(controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) {
            return;
          }
          setItems(rows);
          writeListCache(cacheKey, rows);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || isAbortError(cause)) {
            return;
          }
          setError(describeError(cause, errorFallback));
        })
        .finally(() => {
          if (controller.signal.aborted) {
            return;
          }
          setIsLoading(false);
          setIsRefreshing(false);
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cacheKey, errorFallback, generation]);

  const reload = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  return { items, isLoading, isRefreshing, error, reload };
}

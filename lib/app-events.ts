"use client";

/**
 * The events pages use to tell each other that image data changed.
 *
 * Four files carried their own copies of these names, and every dispatch site fired three
 * events ("library-updated", "generation_events" and a "generation-updated" kept for
 * listeners that no longer existed). One name each, dispatched from one place.
 */

/** Rows or files in the image tables changed — lists should revalidate. */
export const LIBRARY_UPDATED_EVENT = "library-updated";

/** A generation finished — counters should revalidate. */
export const GENERATION_UPDATED_EVENT = "generation_events";

export function dispatchLibraryUpdated() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(LIBRARY_UPDATED_EVENT));
}

export function dispatchGenerationUpdated() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(GENERATION_UPDATED_EVENT));
  dispatchLibraryUpdated();
}

export function subscribeToAppEvent(eventName: string, handler: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}

import { hasPendingGenerationReview, PENDING_GENERATION_REVIEW_KEY } from "@/lib/startsida-review-session";
import { hasPendingSourceSelection, PENDING_SOURCE_SELECTION_KEY } from "@/lib/startsida-source-session";

export const STARTSIDA_CONVERTER_RESET_KEY = "startsida-converter-reset-v1";
export const CONVERTER_TRANSFER_KEY = "converter-selected-upload-v1";
export const LEGACY_SOURCE_PREVIEW_CACHE_KEY = "floorplan-source-preview-v1";

/**
 * A conversion is running. It lives in memory only: a page reload kills the request, so there
 * is nothing worth restoring, but while the app stays open it must count as unfinished. A
 * pasted Polycam link has no stored source selection, so without this the converter was reset
 * on navigation and the running job (and its result) was orphaned.
 */
let conversionInFlight = false;
const inFlightListeners = new Set<() => void>();

export function setConverterConversionInFlight(value: boolean) {
  if (conversionInFlight === value) {
    return;
  }

  conversionInFlight = value;
  inFlightListeners.forEach((listener) => listener());
}

export function hasUnfinishedConverterSession() {
  return conversionInFlight || hasPendingGenerationReview() || hasPendingSourceSelection();
}

export function subscribeUnfinishedConverterSession(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === PENDING_GENERATION_REVIEW_KEY ||
      event.key === PENDING_SOURCE_SELECTION_KEY
    ) {
      onStoreChange();
    }
  };

  const handleFocus = () => onStoreChange();

  inFlightListeners.add(onStoreChange);
  window.addEventListener("storage", handleStorage);
  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleFocus);
  return () => {
    inFlightListeners.delete(onStoreChange);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleFocus);
  };
}

export function hasPendingConverterTransfer(fromUploadParam: string | null) {
  if (typeof window === "undefined") {
    return Boolean(fromUploadParam);
  }

  if (fromUploadParam) {
    return true;
  }

  const rawPayload = window.sessionStorage.getItem(CONVERTER_TRANSFER_KEY);
  if (!rawPayload) {
    return false;
  }

  try {
    const parsed = JSON.parse(rawPayload) as { previewUrl?: string };
    return typeof parsed?.previewUrl === "string" && parsed.previewUrl.length > 0;
  } catch {
    return false;
  }
}

export function consumeStartsidaConverterMountKey(fromUploadParam: string | null) {
  if (typeof window === "undefined") {
    return "initial";
  }

  window.localStorage.removeItem(LEGACY_SOURCE_PREVIEW_CACHE_KEY);

  const shouldReset = window.sessionStorage.getItem(STARTSIDA_CONVERTER_RESET_KEY) === "1";
  window.sessionStorage.removeItem(STARTSIDA_CONVERTER_RESET_KEY);

  if (
    shouldReset &&
    !hasPendingConverterTransfer(fromUploadParam) &&
    !hasUnfinishedConverterSession()
  ) {
    return `reset-${Date.now()}`;
  }

  return "initial";
}

export function markStartsidaConverterForReset() {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(STARTSIDA_CONVERTER_RESET_KEY, "1");
  }
}

import { hasPendingGenerationReview, PENDING_GENERATION_REVIEW_KEY } from "@/lib/startsida-review-session";
import { hasPendingSourceSelection, PENDING_SOURCE_SELECTION_KEY } from "@/lib/startsida-source-session";

export const STARTSIDA_CONVERTER_RESET_KEY = "startsida-converter-reset-v1";
export const CONVERTER_TRANSFER_KEY = "converter-selected-upload-v1";
export const LEGACY_SOURCE_PREVIEW_CACHE_KEY = "floorplan-source-preview-v1";

export function hasUnfinishedConverterSession() {
  return hasPendingGenerationReview() || hasPendingSourceSelection();
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

  window.addEventListener("storage", handleStorage);
  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleFocus);
  return () => {
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
    !hasPendingGenerationReview() &&
    !hasPendingSourceSelection()
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

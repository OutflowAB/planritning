import { hasPendingGenerationReview } from "@/lib/startsida-review-session";
import { hasPendingSourceSelection } from "@/lib/startsida-source-session";

export const STARTSIDA_CONVERTER_RESET_KEY = "startsida-converter-reset-v1";
export const CONVERTER_TRANSFER_KEY = "converter-selected-upload-v1";
export const LEGACY_SOURCE_PREVIEW_CACHE_KEY = "floorplan-source-preview-v1";

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

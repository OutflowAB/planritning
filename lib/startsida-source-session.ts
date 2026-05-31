export const PENDING_SOURCE_SELECTION_KEY = "startsida-pending-source-selection-v1";

export type PendingSourceSelection = {
  previewUrl?: string;
  fileName?: string;
  uploadId?: number;
};

export function getPendingSourceSelection(): PendingSourceSelection | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawPayload = window.sessionStorage.getItem(PENDING_SOURCE_SELECTION_KEY);
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as Partial<PendingSourceSelection>;
    const hasUploadId = typeof parsed?.uploadId === "number";
    const hasPreviewUrl =
      typeof parsed?.previewUrl === "string" && parsed.previewUrl.length > 0;

    if (!hasUploadId && !hasPreviewUrl) {
      return null;
    }

    return {
      ...(hasPreviewUrl ? { previewUrl: parsed.previewUrl } : {}),
      ...(typeof parsed?.fileName === "string" && parsed.fileName.length > 0
        ? { fileName: parsed.fileName }
        : {}),
      ...(hasUploadId ? { uploadId: parsed.uploadId } : {}),
    };
  } catch {
    return null;
  }
}

export function setPendingSourceSelection(payload: PendingSourceSelection) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(PENDING_SOURCE_SELECTION_KEY, JSON.stringify(payload));
}

export function clearPendingSourceSelection() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(PENDING_SOURCE_SELECTION_KEY);
}

export function hasPendingSourceSelection() {
  return getPendingSourceSelection() !== null;
}

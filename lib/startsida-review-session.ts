export const PENDING_GENERATION_REVIEW_KEY = "startsida-pending-generation-review-v1";

export type PendingGenerationReview = {
  resultImageId: number;
  resultImagePath: string;
  sourceImageId: number;
  compareBeforePreviewUrl?: string;
};

export function getPendingGenerationReview(): PendingGenerationReview | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawPayload = window.sessionStorage.getItem(PENDING_GENERATION_REVIEW_KEY);
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as Partial<PendingGenerationReview>;
    if (
      typeof parsed?.resultImageId !== "number" ||
      typeof parsed?.resultImagePath !== "string" ||
      parsed.resultImagePath.length === 0 ||
      typeof parsed?.sourceImageId !== "number"
    ) {
      return null;
    }

    return {
      resultImageId: parsed.resultImageId,
      resultImagePath: parsed.resultImagePath,
      sourceImageId: parsed.sourceImageId,
      ...(typeof parsed.compareBeforePreviewUrl === "string" &&
      parsed.compareBeforePreviewUrl.length > 0
        ? { compareBeforePreviewUrl: parsed.compareBeforePreviewUrl }
        : {}),
    };
  } catch {
    return null;
  }
}

export function setPendingGenerationReview(payload: PendingGenerationReview) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(PENDING_GENERATION_REVIEW_KEY, JSON.stringify(payload));
}

export function clearPendingGenerationReview() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(PENDING_GENERATION_REVIEW_KEY);
}

export function hasPendingGenerationReview() {
  return getPendingGenerationReview() !== null;
}

export function subscribePendingGenerationReview(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PENDING_GENERATION_REVIEW_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener("storage", handleStorage);
  };
}

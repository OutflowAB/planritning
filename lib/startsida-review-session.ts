import type { ConvertLayout } from "@/lib/floorplan/convert-stream";

export const PENDING_GENERATION_REVIEW_KEY = "startsida-pending-generation-review-v1";

export type PendingGenerationReview = {
  resultImageId: number;
  resultImagePath: string;
  sourceImageId: number;
  compareBeforePreviewUrl?: string;
  sourcePreviewUrl?: string;
  resultPreviewUrl?: string;
  /** Where the drawing sits on the canvas, so the before image can be rebuilt to match. */
  layout?: ConvertLayout;
};

function isConvertLayout(value: unknown): value is ConvertLayout {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return ["canvasWidth", "canvasHeight", "imageX", "imageY", "imageWidth", "imageHeight"].every(
    (key) => typeof candidate[key] === "number" && Number.isFinite(candidate[key]),
  );
}

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
      ...(typeof parsed.sourcePreviewUrl === "string" && parsed.sourcePreviewUrl.length > 0
        ? { sourcePreviewUrl: parsed.sourcePreviewUrl }
        : {}),
      ...(typeof parsed.resultPreviewUrl === "string" && parsed.resultPreviewUrl.length > 0
        ? { resultPreviewUrl: parsed.resultPreviewUrl }
        : {}),
      ...(isConvertLayout(parsed.layout) ? { layout: parsed.layout } : {}),
    };
  } catch {
    return null;
  }
}

export function setPendingGenerationReview(payload: PendingGenerationReview) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(PENDING_GENERATION_REVIEW_KEY, JSON.stringify(payload));
  } catch {
    // Over quota. The before preview is the heavy part; drop it and keep the rest, since it
    // can be rebuilt on restore from the stored layout. Losing the whole review would be worse.
    const { compareBeforePreviewUrl: _dropped, ...lighter } = payload;
    void _dropped;
    try {
      window.sessionStorage.setItem(PENDING_GENERATION_REVIEW_KEY, JSON.stringify(lighter));
    } catch {
      // Nothing more to shed; the review simply is not cached this time.
    }
  }
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

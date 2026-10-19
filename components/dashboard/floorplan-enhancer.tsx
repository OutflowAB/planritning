"use client";

import Image from "next/image";
import { Check, Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChangeEvent,
  DragEvent,
  TouchEvent,
  WheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import {
  areCompareImagesCached,
  ImageCompareSlider,
  preloadCompareImageSrc,
  warmCompareImageCache,
  warmCompareImageSrc,
} from "@/components/dashboard/image-compare-slider";
import {
  preventImageContextMenu,
  WatermarkOverlay,
} from "@/components/dashboard/watermark-overlay";
import { ProcessingView } from "@/components/dashboard/processing/processing-view";
import { useToast } from "@/components/ui/toast-provider";
import {
  readConvertStream,
  type ConvertCompass,
  type ConvertDoneEvent,
  type ConvertLayout,
} from "@/lib/floorplan/convert-stream";
import {
  imageDisplayName,
  resolveImageDownloadFileName,
} from "@/lib/image-naming";
import {
  CONVERTER_TRANSFER_KEY,
  hasPendingConverterTransfer,
  setConverterConversionInFlight,
} from "@/lib/startsida-converter-session";
import {
  clearPendingGenerationReview,
  getPendingGenerationReview,
  hasPendingGenerationReview,
  setPendingGenerationReview,
  subscribePendingGenerationReview,
} from "@/lib/startsida-review-session";
import {
  clearPendingSourceSelection,
  getPendingSourceSelection,
  hasPendingSourceSelection,
  setPendingSourceSelection,
} from "@/lib/startsida-source-session";
import { ApiError, apiFetch, apiJson } from "@/lib/api-client";
import { StoreyGallery } from "@/components/dashboard/storey-gallery";
import { StoreyPicker, StoreyProgress, storeyLabel, type StoreyOption } from "@/components/dashboard/storey-picker";
import { markFloor, nextPendingFloor, replaceFloor, updateFloorImage, type StoreyFloor } from "@/lib/storey-floors";
import { CompassControl } from "@/components/dashboard/compass-control";
import { newFloorRun, parseFloorGroup } from "@/lib/floor-groups";
import { defaultCompass, type CompassSettings } from "@/lib/image/compass-settings";
import { dispatchGenerationUpdated } from "@/lib/app-events";
import { imageUrl } from "@/lib/image-url";
import { buttonClass } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { normaliseImageLabel, saveImageLabel, IMAGE_LABEL_MAX_LENGTH } from "@/lib/image-label";
import type { ImageListItem } from "@/app/api/images/route";
import {
  buildPlanritningarHref,
  buildVerktygHref,
  clearPendingVerktygSave,
} from "@/lib/verktyg-save-session";

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
/** Only a coarse check; the server parses the link strictly and never fetches it as given. */
const POLYCAM_LINK_PREFIX = /^https:\/\/poly\.cam\//i;
const UPLOADS_PREFIX = "uploads/";
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.5;
type ConverterTransferPayload = {
  previewUrl: string;
  fileName?: string;
  uploadId?: number;
};

/** Common reasons to send a drawing back, one tap each; they are added to the comment. */
const REJECT_SUGGESTIONS = [
  "En vägg saknas",
  "En dörr är fel placerad",
  "Fönster saknas",
  "Rummen har fel proportioner",
  "Ritningen är beskuren",
];

/**
 * Where the drawing sits on the sheet under review, as fractions, for the compare slider to
 * line the original up within. Read from the stored review, which holds the sheet's layout.
 */
function compareAlignRegion(resultImageId: number | null) {
  const review = resultImageId ? getPendingGenerationReview() : null;
  const layout = review?.resultImageId === resultImageId ? review.layout : undefined;
  if (!layout || layout.canvasWidth <= 0 || layout.canvasHeight <= 0) {
    return null;
  }
  return {
    x: layout.imageX / layout.canvasWidth,
    y: layout.imageY / layout.canvasHeight,
    width: layout.imageWidth / layout.canvasWidth,
    height: layout.imageHeight / layout.canvasHeight,
  };
}

function revokeIfObjectUrl(url: string | null) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Kunde inte läsa jämförelsebilden."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Kunde inte läsa jämförelsebilden."));
    reader.readAsDataURL(blob);
  });
}

async function rebuildCompareBeforePreview(
  sourcePreviewUrl: string,
  fileName?: string,
  layout?: ConvertLayout,
) {
  const sourceResponse = await fetch(sourcePreviewUrl, { cache: "no-store" });
  if (!sourceResponse.ok) {
    return null;
  }

  const sourceBlob = await sourceResponse.blob();
  const payload = new FormData();
  payload.append(
    "file",
    new File([sourceBlob], fileName ?? "planritning-kalla.jpg", {
      type: sourceBlob.type || "image/jpeg",
    }),
  );

  // The slot the result was composed with. Without it the server has to guess a geometry
  // from the original alone, which never matches an AI drawing.
  if (layout) {
    payload.append("layout", JSON.stringify(layout));
  }

  try {
    const compareResponse = await apiFetch("/api/compare-before", { method: "POST", body: payload });
    return await blobToDataUrl(await compareResponse.blob());
  } catch {
    // The caller treats a missing before-image as "show the result without a comparison".
    return null;
  }
}

function peekTransferredSourcePreview() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawPayload = window.sessionStorage.getItem(CONVERTER_TRANSFER_KEY);
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as ConverterTransferPayload;
    if (typeof parsed?.previewUrl !== "string" || parsed.previewUrl.length === 0) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function clearTransferredSourcePreview() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(CONVERTER_TRANSFER_KEY);
}

async function resolveUploadTransferPayload(uploadId: number): Promise<ConverterTransferPayload | null> {
  try {
    const { item } = await apiJson<{ item: ImageListItem }>(`/api/images?id=${uploadId}`);
    if (!item.file_path.startsWith(UPLOADS_PREFIX) || !item.mime_type?.startsWith("image/")) {
      return null;
    }
    return {
      previewUrl: imageUrl(item.id, "full", item.version),
      fileName: resolveImageDownloadFileName(item.id, {
        mimeType: item.mime_type,
        filePath: item.file_path,
      }),
      uploadId: item.id,
    };
  } catch {
    return null;
  }
}

/**
 * Where a generated result can be loaded from, or null when the row is gone. Shaped like the
 * old signed-URL result so the restore paths below read the same, and a deleted image still
 * clears the cached review instead of restoring it around a broken picture.
 */
type ResultPreviewLink =
  | { error: null; data: { signedUrl: string } }
  | { error: Error; data: null };

async function resolveResultPreview(imageId: number): Promise<ResultPreviewLink> {
  try {
    const { item } = await apiJson<{ item: ImageListItem }>(`/api/images?id=${imageId}`);
    return { error: null, data: { signedUrl: imageUrl(item.id, "full", item.version) } };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error("Bilden finns inte längre."), data: null };
  }
}

function dataUrlToFile(dataUrl: string) {
  const [header, payload] = dataUrl.split(",");
  if (!header || !payload) {
    return null;
  }

  const mimeMatch = /^data:([^;]+);base64$/i.exec(header);
  if (!mimeMatch?.[1]) {
    return null;
  }

  const mime = mimeMatch[1];
  let binary: string;
  try {
    binary = window.atob(payload);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new File([bytes], "planritning-cached.png", { type: mime });
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Kunde inte läsa källbilden."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Kunde inte läsa källbilden."));
    reader.readAsDataURL(file);
  });
}

async function persistLocalSourceSelection(file: File) {
  try {
    const previewUrl = await fileToDataUrl(file);
    setPendingSourceSelection({
      previewUrl,
      fileName: file.name,
    });
  } catch {
    // Ignore quota or read errors — navigation restore may not work for very large files.
  }
}

function persistUploadSourceSelection(payload: ConverterTransferPayload) {
  if (typeof payload.uploadId === "number") {
    setPendingSourceSelection({
      uploadId: payload.uploadId,
      fileName: payload.fileName,
      ...(payload.previewUrl ? { previewUrl: payload.previewUrl } : {}),
    });
    return;
  }

  if (payload.previewUrl) {
    setPendingSourceSelection({
      previewUrl: payload.previewUrl,
      fileName: payload.fileName,
    });
  }
}

function readInitialSourcePreviewUrl(
  cachedReviewPreview: ReturnType<typeof readCachedReviewPreviewState>,
  cachedSourcePreview: ReturnType<typeof readCachedSourcePreviewState>,
) {
  if (cachedReviewPreview.sourcePreviewUrl) {
    return cachedReviewPreview.sourcePreviewUrl;
  }

  if (cachedSourcePreview.sourcePreviewUrl) {
    return cachedSourcePreview.sourcePreviewUrl;
  }

  return peekTransferredSourcePreview()?.previewUrl ?? null;
}

function readInitialSourceImageId(
  cachedReviewPreview: ReturnType<typeof readCachedReviewPreviewState>,
  cachedSourcePreview: ReturnType<typeof readCachedSourcePreviewState>,
) {
  if (cachedReviewPreview.sourceImageId) {
    return cachedReviewPreview.sourceImageId;
  }

  if (cachedSourcePreview.sourceImageId) {
    return cachedSourcePreview.sourceImageId;
  }

  const transferredUploadId = peekTransferredSourcePreview()?.uploadId;
  return typeof transferredUploadId === "number" ? transferredUploadId : null;
}

async function resolveSourceFileFromPreview(
  sourcePreviewUrl: string,
  fileName = "planritning.jpg",
) {
  if (sourcePreviewUrl.startsWith("data:")) {
    return dataUrlToFile(sourcePreviewUrl);
  }

  const response = await fetch(sourcePreviewUrl, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }

  const blob = await response.blob();
  return new File([blob], fileName, {
    type: blob.type || "image/jpeg",
  });
}

function useHasPendingGenerationReview() {
  return useSyncExternalStore(
    subscribePendingGenerationReview,
    () => hasPendingGenerationReview(),
    () => false,
  );
}

function readCachedReviewPreviewState() {
  const pendingReview = getPendingGenerationReview();
  if (!pendingReview) {
    return {
      hasPendingReview: false,
      hasCompletePreviewCache: false,
      resultImageId: null as number | null,
      resultImagePath: null as string | null,
      sourceImageId: null as number | null,
      sourcePreviewUrl: null as string | null,
      resultPreviewUrl: null as string | null,
      alignedSourcePreviewUrl: null as string | null,
      isScanSource: false,
    };
  }

  const sourcePreviewUrl =
    typeof pendingReview.sourcePreviewUrl === "string" && pendingReview.sourcePreviewUrl.length > 0
      ? pendingReview.sourcePreviewUrl
      : null;
  const resultPreviewUrl =
    typeof pendingReview.resultPreviewUrl === "string" && pendingReview.resultPreviewUrl.length > 0
      ? pendingReview.resultPreviewUrl
      : null;
  const alignedSourcePreviewUrl =
    typeof pendingReview.compareBeforePreviewUrl === "string" &&
    pendingReview.compareBeforePreviewUrl.length > 0
      ? pendingReview.compareBeforePreviewUrl
      : null;

  return {
    hasPendingReview: true,
    hasCompletePreviewCache: Boolean(sourcePreviewUrl && resultPreviewUrl && alignedSourcePreviewUrl),
    resultImageId: pendingReview.resultImageId,
    resultImagePath: pendingReview.resultImagePath,
    sourceImageId: pendingReview.sourceImageId,
    sourcePreviewUrl,
    resultPreviewUrl,
    alignedSourcePreviewUrl,
    isScanSource: pendingReview.sourceKind === "scan",
  };
}

function readCachedSourcePreviewState() {
  if (getPendingGenerationReview()) {
    return {
      hasPendingSource: false,
      hasCompleteSourceCache: true,
      sourcePreviewUrl: null as string | null,
      sourceFile: null as File | null,
      sourceImageId: null as number | null,
    };
  }

  const pendingSource = getPendingSourceSelection();
  if (!pendingSource) {
    return {
      hasPendingSource: false,
      hasCompleteSourceCache: true,
      sourcePreviewUrl: null as string | null,
      sourceFile: null as File | null,
      sourceImageId: null as number | null,
    };
  }

  if (pendingSource.previewUrl?.startsWith("data:")) {
    const sourceFile = dataUrlToFile(pendingSource.previewUrl);
    return {
      hasPendingSource: true,
      hasCompleteSourceCache: Boolean(sourceFile),
      sourcePreviewUrl: pendingSource.previewUrl,
      sourceFile,
      sourceImageId: null as number | null,
    };
  }

  if (pendingSource.previewUrl) {
    return {
      hasPendingSource: true,
      hasCompleteSourceCache: true,
      sourcePreviewUrl: pendingSource.previewUrl,
      sourceFile: null as File | null,
      sourceImageId:
        typeof pendingSource.uploadId === "number" ? pendingSource.uploadId : null,
    };
  }

  return {
    hasPendingSource: true,
    hasCompleteSourceCache: false,
    sourcePreviewUrl: null as string | null,
    sourceFile: null as File | null,
    sourceImageId:
      typeof pendingSource.uploadId === "number" ? pendingSource.uploadId : null,
  };
}

function ConverterLoadingShell() {
  return (
    <div
      className="w-full space-y-5 rounded-2xl border border-stone-200 bg-white p-4 text-left text-stone-800 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_16px_40px_-24px_rgba(28,25,23,0.16)] sm:p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-stone-700" aria-hidden="true" />
      </div>
    </div>
  );
}

function ComparePreviewSkeleton({ showWatermark = false }: { showWatermark?: boolean }) {
  return (
    <div
      className="flex min-h-[420px] w-full items-center justify-center bg-stone-100 px-6 py-8"
      aria-busy="true"
      aria-live="polite"
      aria-label="Jämförelsebilden laddas"
    >
      <div className="relative h-[min(60vh,640px)] w-full max-w-2xl animate-pulse rounded-lg bg-stone-200">
        {showWatermark ? <WatermarkOverlay /> : null}
      </div>
    </div>
  );
}

/** The compass of one stored sheet as the review knows it. */
type SheetCompassState = {
  settings: CompassSettings;
  /** The last choice the server composed, to fall back to if a change fails. */
  saved: CompassSettings;
  scanRotation: number | null;
  adjustable: boolean;
  reason?: string;
};

const COMPASS_DEBOUNCE_MS = 150;

function sheetCompassFromConversion(compass: ConvertCompass): SheetCompassState {
  const settings = { visible: compass.visible, rotation: compass.rotation };
  return { settings, saved: settings, scanRotation: compass.scanRotation, adjustable: compass.adjustable };
}

export function FloorplanEnhancer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isPendingGenerationReview = useHasPendingGenerationReview();
  const cachedReviewPreview = readCachedReviewPreviewState();
  const cachedSourcePreview = readCachedSourcePreviewState();
  const [hasRestoredPendingReview, setHasRestoredPendingReview] = useState(
    () => !cachedReviewPreview.hasPendingReview || cachedReviewPreview.hasCompletePreviewCache,
  );
  const [hasRestoredPendingSource, setHasRestoredPendingSource] = useState(
    () =>
      !cachedSourcePreview.hasPendingSource ||
      cachedSourcePreview.hasCompleteSourceCache ||
      Boolean(readInitialSourcePreviewUrl(cachedReviewPreview, cachedSourcePreview)),
  );
  const [sourceFile, setSourceFile] = useState<File | null>(() => cachedSourcePreview.sourceFile);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(() =>
    readInitialSourcePreviewUrl(cachedReviewPreview, cachedSourcePreview),
  );
  const [alignedSourcePreviewUrl, setAlignedSourcePreviewUrl] = useState<string | null>(
    () => cachedReviewPreview.alignedSourcePreviewUrl,
  );
  const [resultPreviewUrl, setResultPreviewUrl] = useState<string | null>(
    () => cachedReviewPreview.resultPreviewUrl,
  );
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingStatusMessage, setProcessingStatusMessage] = useState<string | null>(null);
  // The address or name the plan is filed under. Kept for the whole session, so a redraw of a
  // rejected version is filed under the same name.
  const [propertyLabel, setPropertyLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [resultImageId, setResultImageId] = useState<number | null>(
    () => cachedReviewPreview.resultImageId,
  );
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showApproveDestinationModal, setShowApproveDestinationModal] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false);
  const { showToast } = useToast();
  const [resultImagePath, setResultImagePath] = useState<string | null>(
    () => cachedReviewPreview.resultImagePath,
  );
  const [sourceImageId, setSourceImageId] = useState<number | null>(() =>
    readInitialSourceImageId(cachedReviewPreview, cachedSourcePreview),
  );
  // The source is a plan drawn from a Polycam scan: redraws go back through the scan route,
  // which reuses the stored plan and tells the model what it is looking at.
  const [isScanSource, setIsScanSource] = useState(() => cachedReviewPreview.isScanSource);
  const [polycamLink, setPolycamLink] = useState("");
  // Multi-storey scans: the floors to choose from, the run in progress, and every drawn floor
  // with its review status. Any of them can be put in the review card, in any order.
  const [isInspecting, setIsInspecting] = useState(false);
  const [storeyChoice, setStoreyChoice] = useState<{ url: string; storeys: StoreyOption[] } | null>(null);
  const [multiRun, setMultiRun] = useState<{ labels: string[]; done: number } | null>(null);
  const [floors, setFloors] = useState<StoreyFloor[]>([]);
  // The compass choice made before drawing (one per run), and the compass of every sheet shown.
  const [plannedCompass, setPlannedCompass] = useState<CompassSettings>(() => defaultCompass(null));
  const [plannedScanRotation, setPlannedScanRotation] = useState<number | null>(null);
  const [sheetCompass, setSheetCompass] = useState<Record<number, SheetCompassState>>({});
  const [compassPending, setCompassPending] = useState(false);
  const [compassEditedIds, setCompassEditedIds] = useState<number[]>([]);
  const compassTimerRef = useRef<number | null>(null);
  const compassChainRef = useRef<Promise<void>>(Promise.resolve());
  const resultImageIdRef = useRef<number | null>(null);
  const [activeFloor, setActiveFloor] = useState<number | null>(null);
  const [previewImageType, setPreviewImageType] = useState<"source" | "result" | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isCompareSliderReady, setIsCompareSliderReady] = useState(() =>
    Boolean(
      cachedReviewPreview.alignedSourcePreviewUrl &&
        cachedReviewPreview.resultPreviewUrl &&
        areCompareImagesCached(
          cachedReviewPreview.alignedSourcePreviewUrl,
          cachedReviewPreview.resultPreviewUrl,
        ),
    ),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const [sectionOverlayTarget, setSectionOverlayTarget] = useState<HTMLElement | null>(null);

  const hasSourcePreview = Boolean(sourcePreviewUrl);
  const showDropzone = !hasSourcePreview;
  const protectResultPreview = isPendingGenerationReview && Boolean(resultPreviewUrl);
  const activePreviewImageUrl =
    previewImageType === "source"
      ? sourcePreviewUrl
      : previewImageType === "result"
        ? resultPreviewUrl
        : null;
  const clearFromUploadQuery = useCallback(() => {
    if (!searchParams.has("fromUpload")) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("fromUpload");
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const applyTransferredSource = useCallback(
    (transferredSource: ConverterTransferPayload) => {
      setErrorMessage("");
      setIsScanSource(false);
      setSourceImageId(
        typeof transferredSource.uploadId === "number" ? transferredSource.uploadId : null,
      );
      setSourceFile(null);
      setSourcePreviewUrl((previous) => {
        revokeIfObjectUrl(previous);
        return transferredSource.previewUrl;
      });
      clearTransferredSourcePreview();
      clearFromUploadQuery();
      persistUploadSourceSelection(transferredSource);
    },
    [clearFromUploadQuery],
  );


  // Tells the host a job is running so leaving the page does not reset the converter.
  useEffect(() => {
    setConverterConversionInFlight(isSubmitting);
    return () => setConverterConversionInFlight(false);
  }, [isSubmitting]);

  useEffect(() => {
    return () => {
      revokeIfObjectUrl(sourcePreviewUrl);
    };
  }, [sourcePreviewUrl]);

  useEffect(() => {
    return () => {
      revokeIfObjectUrl(resultPreviewUrl);
    };
  }, [resultPreviewUrl]);

  function clearGenerationResult() {
    clearPendingGenerationReview();
    setPreviewImageType(null);
    setPreviewZoom(1);
    setResultImageId(null);
    setResultImagePath(null);
    setShowRejectForm(false);
    setShowApproveDestinationModal(false);
    setSectionOverlayTarget(null);
    setRejectComment("");
    setIsReviewSubmitting(false);
    setAlignedSourcePreviewUrl(null);
    setIsCompareSliderReady(false);
    setResultPreviewUrl((prev) => {
      revokeIfObjectUrl(prev);

      return null;
    });
  }

  function resetResult() {
    clearGenerationResult();
  }

  function resetSourceSelection() {
    clearPendingSourceSelection();
    setErrorMessage("");
    setIsScanSource(false);
    setIsSubmitting(false);
    setSourceFile(null);
    setSourceImageId(null);
    setFloors([]);
    setActiveFloor(null);
    setIsDragActive(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setSourcePreviewUrl((prev) => {
      revokeIfObjectUrl(prev);
      return null;
    });
    resetResult();
  }

  useLayoutEffect(() => {
    if (cachedReviewPreview.alignedSourcePreviewUrl) {
      warmCompareImageSrc(cachedReviewPreview.alignedSourcePreviewUrl);
    }

    if (cachedReviewPreview.alignedSourcePreviewUrl && cachedReviewPreview.resultPreviewUrl) {
      warmCompareImageCache(
        cachedReviewPreview.alignedSourcePreviewUrl,
        cachedReviewPreview.resultPreviewUrl,
      );
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function restorePendingReview() {
      const pendingReview = getPendingGenerationReview();
      if (!pendingReview) {
        setHasRestoredPendingReview(true);
        return;
      }

      if (cachedReviewPreview.hasCompletePreviewCache) {
        void (async () => {
          try {
            const [sourcePayload, signedResult] = await Promise.all([
              resolveUploadTransferPayload(pendingReview.sourceImageId),
              resolveResultPreview(pendingReview.resultImageId),
            ]);

            if (isCancelled) {
              return;
            }

            if (
              !sourcePayload?.previewUrl ||
              signedResult.error ||
              !signedResult.data?.signedUrl
            ) {
              // Supabase answered, and the image is not there. The cached previews point at a
              // deleted object or carry an expired token, so showing them yields a broken
              // image and a review that can never be submitted.
              clearGenerationResult();

              if (!sourcePayload?.previewUrl) {
                // The original upload is gone too, so there is nothing left to convert.
                clearPendingSourceSelection();
                setSourceFile(null);
                setSourceImageId(null);
                setSourcePreviewUrl((previous) => {
                  revokeIfObjectUrl(previous);
                  return null;
                });
              }

              setErrorMessage(
                "Den här bilden finns inte kvar. Ladda upp planritningen och konvertera på nytt.",
              );
              return;
            }

            setSourcePreviewUrl((previous) => {
              if (previous === sourcePayload.previewUrl) {
                return previous;
              }

              revokeIfObjectUrl(previous);
              return sourcePayload.previewUrl;
            });
            setResultPreviewUrl((previous) => {
              if (previous === signedResult.data.signedUrl) {
                return previous;
              }

              revokeIfObjectUrl(previous);
              return signedResult.data.signedUrl;
            });
            setPendingGenerationReview({
              ...pendingReview,
              sourcePreviewUrl: sourcePayload.previewUrl,
              resultPreviewUrl: signedResult.data.signedUrl,
            });
          } catch {
            // Keep cached previews visible if background refresh fails.
          }
        })();
        return;
      }

      setErrorMessage("");

      try {
        const [sourcePayload, signedResult] = await Promise.all([
          resolveUploadTransferPayload(pendingReview.sourceImageId),
          resolveResultPreview(pendingReview.resultImageId),
        ]);

        if (isCancelled) {
          return;
        }

        if (!sourcePayload?.previewUrl || signedResult.error || !signedResult.data?.signedUrl) {
          clearPendingGenerationReview();
          setErrorMessage("Kunde inte återställa granskningen. Starta om konverteringen.");
          return;
        }

        setSourceImageId(pendingReview.sourceImageId);
        setSourcePreviewUrl((previous) => {
          revokeIfObjectUrl(previous);
          return sourcePayload.previewUrl;
        });
        setResultImageId(pendingReview.resultImageId);
        setResultImagePath(pendingReview.resultImagePath);
        setResultPreviewUrl((previous) => {
          revokeIfObjectUrl(previous);
          return signedResult.data.signedUrl;
        });

        const restoredComparePreview =
          pendingReview.compareBeforePreviewUrl ??
          (await rebuildCompareBeforePreview(
            sourcePayload.previewUrl,
            sourcePayload.fileName,
            pendingReview.layout,
          ));
        setAlignedSourcePreviewUrl(restoredComparePreview);
        if (restoredComparePreview) {
          warmCompareImageCache(restoredComparePreview, signedResult.data.signedUrl);
          setPendingGenerationReview({
            ...pendingReview,
            compareBeforePreviewUrl: restoredComparePreview,
            sourcePreviewUrl: sourcePayload.previewUrl,
            resultPreviewUrl: signedResult.data.signedUrl,
          });
        }
      } catch {
        if (!isCancelled) {
          clearPendingGenerationReview();
          setErrorMessage("Kunde inte återställa granskningen. Starta om konverteringen.");
        }
      } finally {
        if (!isCancelled) {
          setHasRestoredPendingReview(true);
        }
      }
    }

    void restorePendingReview();
    return () => {
      isCancelled = true;
    };
  }, [cachedReviewPreview.hasCompletePreviewCache]);

  const isRestoringPendingReview = isPendingGenerationReview && !hasRestoredPendingReview;
  const isRestoringPendingSource = hasPendingSourceSelection() && !hasRestoredPendingSource;
  const showGenerationReview =
    Boolean(resultPreviewUrl && sourcePreviewUrl) || isRestoringPendingReview;
  const activeFloorApproved =
    activeFloor !== null && floors.length > 1 && floors[activeFloor]?.status === "approved";
  const isComparePreviewLoading =
    showGenerationReview && (!resultPreviewUrl || !sourcePreviewUrl || !alignedSourcePreviewUrl);
  const isCompareReviewReady = Boolean(
    alignedSourcePreviewUrl && resultPreviewUrl && isCompareSliderReady,
  );

  useEffect(() => {
    resultImageIdRef.current = resultImageId;
  }, [resultImageId]);

  // A review restored from the session knows no compass yet: ask the server what the sheet has.
  useEffect(() => {
    if (!resultImageId || sheetCompass[resultImageId]) {
      return;
    }
    let cancelled = false;
    void apiJson<{
      visible: boolean;
      rotation: number;
      scanRotation: number | null;
      adjustable: boolean;
      reason?: string;
    }>(`/api/recompose-sheet?imageId=${resultImageId}`)
      .then((state) => {
        if (cancelled) {
          return;
        }
        const settings = { visible: state.visible, rotation: state.rotation };
        setSheetCompass((previous) => ({
          ...previous,
          [resultImageId]: {
            settings,
            saved: settings,
            scanRotation: state.scanRotation,
            adjustable: state.adjustable,
            reason: state.reason,
          },
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [resultImageId, sheetCompass]);

  const handleCompareSliderReadyChange = useCallback((ready: boolean) => {
    setIsCompareSliderReady(ready);
  }, []);

  useEffect(() => {
    if (alignedSourcePreviewUrl && resultPreviewUrl) {
      warmCompareImageCache(alignedSourcePreviewUrl, resultPreviewUrl);
    }
  }, [alignedSourcePreviewUrl, resultPreviewUrl]);

  useEffect(() => {
    let isCancelled = false;

    async function restorePendingSourceSelection() {
      if (getPendingGenerationReview()) {
        setHasRestoredPendingSource(true);
        return;
      }

      if (hasPendingConverterTransfer(searchParams.get("fromUpload"))) {
        setHasRestoredPendingSource(true);
        return;
      }

      if (cachedSourcePreview.hasCompleteSourceCache) {
        return;
      }

      const pendingSource = getPendingSourceSelection();
      if (!pendingSource) {
        setHasRestoredPendingSource(true);
        return;
      }

      setErrorMessage("");

      try {
        if (typeof pendingSource.uploadId === "number") {
          const payload = await resolveUploadTransferPayload(pendingSource.uploadId);
          if (!payload?.previewUrl) {
            clearPendingSourceSelection();
            return;
          }

          applyTransferredSource(payload);
          return;
        }

        if (pendingSource.previewUrl?.startsWith("data:")) {
          const restoredFile = dataUrlToFile(pendingSource.previewUrl);
          if (!restoredFile) {
            clearPendingSourceSelection();
            return;
          }

          setSourceFile(restoredFile);
          setSourceImageId(null);
          setSourcePreviewUrl((previous) => {
            revokeIfObjectUrl(previous);
            return pendingSource.previewUrl ?? null;
          });
          return;
        }

        clearPendingSourceSelection();
      } catch {
        if (!isCancelled) {
          clearPendingSourceSelection();
          setErrorMessage("Kunde inte återställa vald bild. Välj bilden igen.");
        }
      } finally {
        if (!isCancelled) {
          setHasRestoredPendingSource(true);
        }
      }
    }

    void restorePendingSourceSelection();
    return () => {
      isCancelled = true;
    };
  }, [applyTransferredSource, searchParams]);

  useEffect(() => {
    let isCancelled = false;

    async function hydrateTransferredSource() {
      if (getPendingGenerationReview()) {
        return;
      }

      if (!hasPendingConverterTransfer(searchParams.get("fromUpload"))) {
        return;
      }

      let transferredSource = peekTransferredSourcePreview();

      if (!transferredSource) {
        const fromUploadParam = searchParams.get("fromUpload");
        const fromUploadId =
          fromUploadParam && !Number.isNaN(Number(fromUploadParam)) ? Number(fromUploadParam) : null;

        if (fromUploadId) {
          transferredSource = await resolveUploadTransferPayload(fromUploadId);
        }
      }

      // The lookup above may resolve after the user has already left.
      if (isCancelled) {
        return;
      }

      if (transferredSource?.previewUrl) {
        applyTransferredSource(transferredSource);
      }
    }

    void hydrateTransferredSource();
    return () => {
      isCancelled = true;
    };
  }, [applyTransferredSource, searchParams]);

  function assignFile(file: File | null) {
    if (!file) {
      return;
    }

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setErrorMessage("Välj en PNG, JPG eller WEBP-fil.");
      return;
    }

    setErrorMessage("");
    setIsScanSource(false);
    setSourceFile(file);
    setSourceImageId(null);
    setSourcePreviewUrl((prev) => {
      revokeIfObjectUrl(prev);
      return URL.createObjectURL(file);
    });
    resetResult();
    void persistLocalSourceSelection(file);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    assignFile(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    assignFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);
  }

  /** Files a finished conversion, and the original it came from, under the chosen name. */
  function labelConversion(conversion: ConvertDoneEvent) {
    const label = normaliseImageLabel(propertyLabel);
    if (!label) {
      return;
    }
    const ids = [conversion.savedImageId, conversion.sourceImageId].filter((id) => id > 0);
    void saveImageLabel(ids, label).then((saved) => {
      if (!saved) {
        console.warn("Plan name not saved", { ids, label });
      }
    });
  }

  async function processImage(file?: File, feedback?: string) {
    if (isSubmitting) {
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);
    setProcessingStatusMessage(null);

    try {
      let resolvedFile = file ?? sourceFile;
      if (!resolvedFile && sourcePreviewUrl) {
        const pendingSource = getPendingSourceSelection();
        resolvedFile = await resolveSourceFileFromPreview(
          sourcePreviewUrl,
          pendingSource?.fileName ?? "planritning.jpg",
        );
        if (resolvedFile) {
          setSourceFile(resolvedFile);
        }
      }

      if (!resolvedFile) {
        throw new Error("Kunde inte läsa bilden igen. Ladda upp bilden på nytt.");
      }

      const payload = new FormData();
      payload.append("file", resolvedFile);
      if (sourceImageId) {
        payload.append("sourceImageId", String(sourceImageId));
      }
      const { compass } = requestCompass();
      payload.append("compassVisible", compass.visible ? "1" : "0");
      payload.append("compassRotation", String(compass.rotation));
      // Why the previous attempt was rejected. Sent along so the next version can correct it
      // rather than being a blind re-roll.
      if (feedback) {
        payload.append("feedback", feedback);
      }

      const response = await apiFetch("/api/convert", { method: "POST", body: payload });

      const conversion = await readConvertStream(response, {
        onStatus: (event) => setProcessingStatusMessage(event.message),
      });
      labelConversion(conversion);

      applyConversionResult(conversion, sourcePreviewUrl ?? undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ett oväntat fel uppstod.");
    } finally {
      setIsSubmitting(false);
      setProcessingStatusMessage(null);
    }
  }

  function rememberCompass(conversion: ConvertDoneEvent) {
    const { compass, savedImageId } = conversion;
    if (!compass) {
      return;
    }
    setSheetCompass((previous) => ({ ...previous, [savedImageId]: sheetCompassFromConversion(compass) }));
  }

  /** The compass to draw a new version with: what the shown sheet has, else the planned one. */
  function requestCompass(): { compass: CompassSettings; scanRotation: number | null } {
    const current = resultImageId ? sheetCompass[resultImageId] : undefined;
    return current
      ? { compass: current.settings, scanRotation: current.scanRotation }
      : { compass: plannedCompass, scanRotation: plannedScanRotation };
  }

  /**
   * A change to the shown sheet's compass: the control updates at once, the sheet is composed
   * again on the server after a short pause (no new drawing, no credit), and its new picture
   * replaces the old one when it has loaded.
   */
  function changeSheetCompass(next: CompassSettings) {
    const imageId = resultImageId;
    if (!imageId) {
      return;
    }
    setSheetCompass((previous) =>
      previous[imageId] ? { ...previous, [imageId]: { ...previous[imageId], settings: next } } : previous,
    );
    setCompassPending(true);
    if (compassTimerRef.current !== null) {
      window.clearTimeout(compassTimerRef.current);
    }
    compassTimerRef.current = window.setTimeout(() => {
      compassTimerRef.current = null;
      compassChainRef.current = compassChainRef.current.then(async () => {
        try {
          const result = await apiJson<{ savedImageUrl: string }>("/api/recompose-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageId, compass: next }),
          });
          await preloadCompareImageSrc(result.savedImageUrl).catch(() => undefined);
          setSheetCompass((previous) =>
            previous[imageId] ? { ...previous, [imageId]: { ...previous[imageId], saved: next } } : previous,
          );
          setCompassEditedIds((previous) => (previous.includes(imageId) ? previous : [...previous, imageId]));
          setFloors((previous) => updateFloorImage(previous, imageId, result.savedImageUrl));
          if (resultImageIdRef.current === imageId) {
            setResultPreviewUrl(result.savedImageUrl);
            const pending = getPendingGenerationReview();
            if (pending?.resultImageId === imageId) {
              setPendingGenerationReview({ ...pending, resultPreviewUrl: result.savedImageUrl });
            }
          }
        } catch (error) {
          setSheetCompass((previous) =>
            previous[imageId]
              ? { ...previous, [imageId]: { ...previous[imageId], settings: previous[imageId].saved } }
              : previous,
          );
          setErrorMessage(error instanceof Error ? error.message : "Kunde inte ändra kompassen.");
        } finally {
          if (compassTimerRef.current === null) {
            setCompassPending(false);
          }
        }
      });
    }, COMPASS_DEBOUNCE_MS);
  }

  /** Shows a finished conversion for review and caches it, whichever route produced it. */
  function applyConversionResult(
    conversion: ConvertDoneEvent,
    reviewSourcePreviewUrl: string | undefined,
    sourceKind?: "scan",
  ) {
    const parsedSavedImageId = conversion.savedImageId;
    const parsedSourceImageId = conversion.sourceImageId;
    rememberCompass(conversion);
    const savedImagePath = conversion.savedImagePath;
    if (parsedSourceImageId) {
      setSourceImageId(parsedSourceImageId);
    }
    setResultImageId(parsedSavedImageId);
    setResultImagePath(savedImagePath);
    const compareBeforeDataUrl = conversion.compareBefore;
    setAlignedSourcePreviewUrl(compareBeforeDataUrl);
    const nextResultPreviewUrl = conversion.savedImageUrl || conversion.result;
    warmCompareImageCache(compareBeforeDataUrl, nextResultPreviewUrl);
    setResultPreviewUrl((prev) => {
      revokeIfObjectUrl(prev);
      return nextResultPreviewUrl;
    });
    if (parsedSavedImageId && savedImagePath && parsedSourceImageId) {
      clearPendingSourceSelection();
      setPendingGenerationReview({
        resultImageId: parsedSavedImageId,
        resultImagePath: savedImagePath,
        sourceImageId: parsedSourceImageId,
        compareBeforePreviewUrl: compareBeforeDataUrl,
        sourcePreviewUrl: reviewSourcePreviewUrl,
        resultPreviewUrl: nextResultPreviewUrl,
        layout: conversion.layout,
        ...(sourceKind ? { sourceKind } : {}),
      });
    }
    dispatchGenerationUpdated();
  }

  /** Puts a finished scan conversion up for review. */
  function showScanResult(conversion: ConvertDoneEvent) {
    // There is no local file: the plan the server drew from the scan is the original.
    const scanPreviewUrl = imageUrl(conversion.sourceImageId, "full");
    setSourceFile(null);
    setSourcePreviewUrl((previous) => {
      if (previous === scanPreviewUrl) {
        return previous;
      }
      revokeIfObjectUrl(previous);
      return scanPreviewUrl;
    });
    setIsScanSource(true);
    setPolycamLink("");
    applyConversionResult(conversion, scanPreviewUrl, "scan");
  }

  /** Puts one of the drawn floors in the review card. */
  function selectFloor(index: number, list: StoreyFloor[] = floors) {
    const floor = list[index];
    if (!floor) {
      return;
    }
    setActiveFloor(index);
    setShowRejectForm(false);
    setRejectComment("");
    setErrorMessage("");
    setPreviewZoom(1);
    if (index !== activeFloor) {
      setIsCompareSliderReady(false);
      showScanResult(floor.conversion);
    }
  }

  function enlargeFloor(index: number) {
    selectFloor(index);
    setPreviewImageType("result");
  }

  /** Marks the shown floor approved and moves on to one that is still open. Returns whether there was one. */
  function finishActiveFloor() {
    if (activeFloor === null || floors.length < 2) {
      return false;
    }
    const updated = markFloor(floors, activeFloor, "approved");
    setFloors(updated);
    const next = nextPendingFloor(updated, activeFloor);
    if (next < 0) {
      return false;
    }
    selectFloor(next, updated);
    return true;
  }

  /** Approves and saves every floor still open to Planritningar in one go. */
  async function approveAllFloors() {
    const open = floors.filter((floor) => floor.status !== "approved");
    if (isReviewSubmitting || open.length === 0) {
      return;
    }

    setErrorMessage("");
    setIsReviewSubmitting(true);
    try {
      for (const { conversion } of open) {
        const body = { imageId: conversion.savedImageId, filePath: conversion.savedImagePath };
        await apiFetch("/api/review-generation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve", ...body }),
        });
        await apiFetch("/api/save-generation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setFloors((previous) =>
          previous.map((floor) =>
            floor.conversion.savedImageId === conversion.savedImageId
              ? { ...floor, status: "approved" }
              : floor,
          ),
        );
      }
      clearPendingVerktygSave();
      clearPendingGenerationReview();
      dispatchGenerationUpdated();
      const last = open[open.length - 1].conversion;
      router.push(
        buildPlanritningarHref(pathname, { imageId: last.savedImageId, imagePath: last.savedImagePath }),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ett oväntat fel uppstod.");
    } finally {
      setIsReviewSubmitting(false);
    }
  }

  /**
   * Draws the chosen storeys one at a time, each as its own conversion (and its own
   * generation). Every finished plan lands in the floor gallery; the first one is shown.
   */
  async function processPolycamStoreys(url: string, stories: number[], storeys: StoreyOption[]) {
    if (isSubmitting) {
      return;
    }

    const labels = stories.map((story) =>
      storeyLabel(
        storeys.findIndex((entry) => entry.story === story),
        storeys.length,
      ),
    );
    const results: ConvertDoneEvent[] = [];
    // One id for the whole run, so the library can show these floors as one house.
    const run = newFloorRun();

    setErrorMessage("");
    setStoreyChoice(null);
    setIsSubmitting(true);
    setProcessingStatusMessage(null);
    setMultiRun({ labels, done: 0 });
    setFloors([]);
    setActiveFloor(null);

    try {
      for (const [index, story] of stories.entries()) {
        const response = await apiFetch("/api/convert-polycam", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            story,
            compass: plannedCompass,
            floorGroup: {
              run,
              position: storeys.findIndex((entry) => entry.story === story),
              total: storeys.length,
            },
          }),
        });
        const conversion = await readConvertStream(response, {
          onStatus: (event) => setProcessingStatusMessage(`${labels[index]}: ${event.message}`),
        });
        labelConversion(conversion);
        results.push(conversion);
        setMultiRun({ labels, done: index + 1 });
      }
    } catch (error) {
      // Floors already drawn are kept and reviewable; only the failing one and later ones are lost.
      const reason = error instanceof Error ? error.message : "Ett oväntat fel uppstod.";
      setErrorMessage(
        results.length > 0
          ? `${labels[results.length]} kunde inte konverteras: ${reason}`
          : reason,
      );
    } finally {
      setIsSubmitting(false);
      setProcessingStatusMessage(null);
      setMultiRun(null);
    }

    const [first] = results;
    results.forEach(rememberCompass);
    if (first) {
      setFloors(
        results.map((conversion, index) => ({
          label: labels[index],
          conversion,
          status: "pending" as const,
        })),
      );
      setActiveFloor(0);
      showScanResult(first);
    }
  }

  /** Reads the scan first: a multi-storey one asks which floors to draw before anything is billed. */
  async function inspectPolycamLink(link: string) {
    setErrorMessage("");
    setIsInspecting(true);
    try {
      const { storeys, compassRotation } = await apiJson<{
        storeys: StoreyOption[];
        compassRotation: number | null;
      }>("/api/convert-polycam/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      // Both the compass and (for several floors) the floors are settled before anything is drawn.
      setPlannedScanRotation(compassRotation ?? null);
      setPlannedCompass(defaultCompass(compassRotation ?? null));
      setStoreyChoice({ url: link, storeys });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ett oväntat fel uppstod.");
    } finally {
      setIsInspecting(false);
    }
  }

  /**
   * Converts a Polycam capture. With a link, the server downloads and draws the scan; with
   * the id of a plan it drew before (a redraw), it reuses that plan without Polycam.
   */
  async function processPolycamLink(
    target: { url: string } | { sourceImageId: number },
    feedback?: string,
  ) {
    if (isSubmitting) {
      return;
    }

    setStoreyChoice(null);
    // A redraw of one floor of a multi-storey run keeps its place in the gallery.
    const redoIndex = "sourceImageId" in target ? activeFloor : null;
    if (redoIndex === null) {
      setFloors([]);
      setActiveFloor(null);
    }

    setErrorMessage("");
    setIsSubmitting(true);
    setProcessingStatusMessage(null);

    try {
      const response = await apiFetch("/api/convert-polycam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...target,
          ...(feedback ? { feedback } : {}),
          // A redraw keeps the sheet's compass; a fresh link uses what was chosen before drawing.
          compass: requestCompass().compass,
          // A redrawn floor stays in its house.
          ...(redoIndex !== null && parseFloorGroup(floors[redoIndex]?.conversion.savedImagePath)
            ? { floorGroup: parseFloorGroup(floors[redoIndex]?.conversion.savedImagePath) }
            : {}),
          ...("sourceImageId" in target && requestCompass().scanRotation !== null
            ? { scanRotation: requestCompass().scanRotation }
            : {}),
        }),
      });

      const conversion = await readConvertStream(response, {
        onStatus: (event) => setProcessingStatusMessage(event.message),
      });
      labelConversion(conversion);

      if (redoIndex !== null) {
        setFloors((previous) => replaceFloor(previous, redoIndex, conversion));
      }
      showScanResult(conversion);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ett oväntat fel uppstod.");
    } finally {
      setIsSubmitting(false);
      setProcessingStatusMessage(null);
    }
  }

  function submitPolycamLink() {
    const link = polycamLink.trim();
    if (!POLYCAM_LINK_PREFIX.test(link)) {
      setErrorMessage("Länken måste börja med https://poly.cam/.");
      return;
    }

    void inspectPolycamLink(link);
  }

  function startConversion() {
    if (isSubmitting) {
      return;
    }

    if (isScanSource && sourceImageId) {
      void processPolycamLink({ sourceImageId });
      return;
    }

    void processImage();
  }

  async function submitGenerationReview(
    action: "approve" | "reject",
    destination?: "verktyg" | "planritningar",
  ) {
    if (isReviewSubmitting || !resultImageId || !resultImagePath) {
      return;
    }

    const trimmedComment = rejectComment.trim();
    if (action === "reject" && !trimmedComment) {
      setErrorMessage("Beskriv vad som ska bli annorlunda innan du konverterar på nytt.");
      return;
    }

    setErrorMessage("");
    setIsReviewSubmitting(true);

    try {
      try {
        await apiFetch("/api/review-generation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            imageId: resultImageId,
            filePath: resultImagePath,
            ...(action === "reject" ? { comment: trimmedComment } : {}),
          }),
        });
      } catch (error) {
        // The image is gone from the database, so the cached review can never be resolved.
        // Clear it instead of leaving the user on a dead form with a broken preview.
        if (error instanceof ApiError && error.kind === "not-found") {
          clearGenerationResult();
          setErrorMessage(
            "Den här bilden finns inte kvar. Ladda upp planritningen och konvertera på nytt.",
          );
          return;
        }
        throw error;
      }

      if (action === "approve") {
        if (destination === "planritningar") {
          await apiFetch("/api/save-generation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageId: resultImageId, filePath: resultImagePath }),
          });

          clearPendingVerktygSave();
          clearPendingGenerationReview();
          setShowRejectForm(false);
          setShowApproveDestinationModal(false);
          setSectionOverlayTarget(null);
          setRejectComment("");
          dispatchGenerationUpdated();
          // More floors are waiting: stay here and review the next one instead of leaving.
          if (finishActiveFloor()) {
            showToast("Våningen är sparad. Nästa våning väntar på granskning.");
            return;
          }
          router.push(
            buildPlanritningarHref(pathname, {
              imageId: resultImageId,
              imagePath: resultImagePath,
            }),
          );
          return;
        }

        clearPendingGenerationReview();
        setShowRejectForm(false);
        setShowApproveDestinationModal(false);
        setSectionOverlayTarget(null);
        setRejectComment("");
        // The editor takes this one; the next floor is ready for when the user comes back.
        finishActiveFloor();
        router.push(
          buildVerktygHref(pathname, {
            imageId: resultImageId,
            imagePath: resultImagePath,
          }),
        );
        return;
      }

      // A rejection is a request for another attempt, not the end of the road. The source is
      // kept and converted again straight away, with the comment passed along as a correction.
      clearGenerationResult();
      showToast("Konverterar bilden på nytt med din kommentar.");
      dispatchGenerationUpdated();
      setIsReviewSubmitting(false);
      if (isScanSource && sourceImageId) {
        void processPolycamLink({ sourceImageId }, trimmedComment);
      } else {
        void processImage(undefined, trimmedComment);
      }
      return;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ett oväntat fel uppstod.");
    } finally {
      setIsReviewSubmitting(false);
    }
  }

  function openApproveDestinationModal() {
    setErrorMessage("");
    setSectionOverlayTarget(rootRef.current?.closest("section") ?? null);
    setShowApproveDestinationModal(true);
  }

  function closeApproveDestinationModal() {
    if (isReviewSubmitting) {
      return;
    }

    setShowApproveDestinationModal(false);
    setSectionOverlayTarget(null);
  }

  function openRejectForm() {
    setErrorMessage("");
    setShowRejectForm(true);
  }

  function cancelRejectForm() {
    setShowRejectForm(false);
    setRejectComment("");
    setErrorMessage("");
  }

  function leavePreview() {
    if (isSubmitting) {
      return;
    }

    resetSourceSelection();
  }

  function openSourcePreview() {
    if (!sourcePreviewUrl) {
      return;
    }

    setPreviewZoom(1);
    setPreviewImageType("source");
  }

  function closeImagePreview() {
    setPreviewZoom(1);
    setPreviewImageType(null);
  }

  function zoomPreviewIn() {
    setPreviewZoom((previous) =>
      Math.min(MAX_PREVIEW_ZOOM, Number((previous + PREVIEW_ZOOM_STEP).toFixed(2))),
    );
  }

  function zoomPreviewOut() {
    setPreviewZoom((previous) =>
      Math.max(MIN_PREVIEW_ZOOM, Number((previous - PREVIEW_ZOOM_STEP).toFixed(2))),
    );
  }

  function resetPreviewZoom() {
    setPreviewZoom(1);
  }

  function getTouchDistance(
    touchA: Pick<TouchEvent<HTMLDivElement>["touches"][number], "clientX" | "clientY">,
    touchB: Pick<TouchEvent<HTMLDivElement>["touches"][number], "clientX" | "clientY">,
  ) {
    const deltaX = touchA.clientX - touchB.clientX;
    const deltaY = touchA.clientY - touchB.clientY;
    return Math.hypot(deltaX, deltaY);
  }

  function handlePreviewTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2) {
      return;
    }

    pinchStartDistanceRef.current = getTouchDistance(event.touches[0], event.touches[1]);
    pinchStartZoomRef.current = previewZoom;
  }

  function handlePreviewTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2 || !pinchStartDistanceRef.current) {
      return;
    }

    event.preventDefault();
    const currentDistance = getTouchDistance(event.touches[0], event.touches[1]);
    const relativeScale = currentDistance / pinchStartDistanceRef.current;
    const nextZoom = pinchStartZoomRef.current * relativeScale;
    const clampedZoom = Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, nextZoom));
    setPreviewZoom(Number(clampedZoom.toFixed(2)));
  }

  function handlePreviewTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length < 2) {
      pinchStartDistanceRef.current = null;
    }
  }

  function handlePreviewWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const zoomDelta = -event.deltaY * 0.01;
    setPreviewZoom((previous) => {
      const next = previous + zoomDelta;
      const clamped = Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, next));
      return Number(clamped.toFixed(2));
    });
  }

  const closeApproveDestinationModalRef = useRef(closeApproveDestinationModal);
  const closeImagePreviewRef = useRef(closeImagePreview);
  useLayoutEffect(() => {
    closeApproveDestinationModalRef.current = closeApproveDestinationModal;
    closeImagePreviewRef.current = closeImagePreview;
  });

  useEffect(() => {
    if (!previewImageType && !showApproveDestinationModal) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (showApproveDestinationModal) {
        closeApproveDestinationModalRef.current();
        return;
      }

      closeImagePreviewRef.current();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [previewImageType, showApproveDestinationModal, isReviewSubmitting]);

  if (isRestoringPendingSource && !showGenerationReview) {
    return <ConverterLoadingShell />;
  }

  const approveDestinationModal = showApproveDestinationModal ? (
    <div
      className={`${sectionOverlayTarget ? "absolute" : "fixed"} inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6`}
      onClick={closeApproveDestinationModal}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg border border-stone-200 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-labelledby="approve-destination-title"
        aria-describedby="approve-destination-description"
      >
        <div className="flex items-start justify-between gap-3 border-b border-stone-100 bg-stone-50 px-4 py-3">
          <h2 id="approve-destination-title" className="text-sm font-semibold text-stone-800">
            Planritningen är klar
          </h2>
          <button
            type="button"
            onClick={closeApproveDestinationModal}
            disabled={isReviewSubmitting}
            aria-label="Stäng"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="px-4 py-4">
          <p id="approve-destination-description" className="text-sm text-stone-600">
            Fortsätt redigera om du vill göra fler ändringar, eller spara planritningen direkt.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 bg-stone-50 px-4 py-3">
          <button
            type="button"
            onClick={() => void submitGenerationReview("approve", "verktyg")}
            disabled={isReviewSubmitting}
            className={buttonClass("primary", "lg", "sm:min-w-[157px]")}
          >
            {isReviewSubmitting ? "Sparar..." : "Redigera"}
          </button>
          <button
            type="button"
            onClick={() => void submitGenerationReview("approve", "planritningar")}
            disabled={isReviewSubmitting}
            className={buttonClass("primary", "lg", "sm:min-w-[157px]")}
          >
            {isReviewSubmitting ? "Sparar..." : "Spara"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className="w-full space-y-5 rounded-2xl border border-stone-200 bg-white p-4 text-left text-stone-800 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_16px_40px_-24px_rgba(28,25,23,0.16)] sm:p-6"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="sr-only"
        onChange={handleFileInputChange}
      />

      {isSubmitting ? (
        <>
          <ProcessingView statusMessage={processingStatusMessage} label={normaliseImageLabel(propertyLabel)} />
          {multiRun ? <StoreyProgress labels={multiRun.labels} done={multiRun.done} /> : null}
        </>
      ) : (
        <>
          {showDropzone ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <label htmlFor="property-label" className="text-[13px] font-medium text-stone-800">
                    Adress eller namn
                  </label>
                  <InfoTip label="Om adress eller namn">
                    Namnet visas i arkivet och går att söka på, både under Planritningar och i
                    snabbsöket (⌘K). Du kan ändra det senare genom att klicka på namnet.
                  </InfoTip>
                </span>
                <span className="text-xs text-stone-400">Valfritt</span>
              </div>
              <input
                id="property-label"
                type="text"
                autoComplete="off"
                maxLength={IMAGE_LABEL_MAX_LENGTH}
                value={propertyLabel}
                onChange={(event) => setPropertyLabel(event.target.value)}
                placeholder="t.ex. Storgatan 12, Göteborg"
                className="h-11 w-full rounded-lg border border-stone-200 bg-white px-3.5 text-sm text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.04)] outline-none transition placeholder:text-stone-400 hover:border-stone-300 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              <p className="mt-1.5 text-xs text-stone-500">
                Planritningen sparas under det här namnet, så att den är lätt att hitta i arkivet.
              </p>
            </div>
          ) : null}

          {showDropzone ? (
            <label
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => {
                fileInputRef.current?.click();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              tabIndex={0}
              className={`group flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-xl border-[1.5px] border-dashed px-6 py-10 text-center transition ${
                isDragActive
                  ? "border-accent bg-accent/5"
                  : "border-stone-300 bg-stone-50/70 hover:border-stone-400 hover:bg-stone-50"
              }`}
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-[0_1px_2px_rgba(28,25,23,0.06)] ring-1 ring-stone-200 transition group-hover:-translate-y-0.5 ${
                  isDragActive ? "text-accent" : "text-stone-500"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
                  <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <p className="mt-4 text-[15px] font-medium text-stone-900">
                {isDragActive ? "Släpp för att ladda upp" : "Dra hit en planritning"}
              </p>
              <p className="mt-1 text-sm text-stone-500">
                eller <span className="font-medium text-stone-800 underline decoration-stone-300 underline-offset-4">välj en fil</span> · PNG, JPG eller WEBP
              </p>
            </label>
          ) : null}

          {showDropzone && storeyChoice ? (
            <StoreyPicker
              storeys={storeyChoice.storeys}
              onCancel={() => setStoreyChoice(null)}
              compass={
                <CompassControl
                  value={plannedCompass}
                  onChange={setPlannedCompass}
                />
              }
              onConfirm={(stories) =>
                storeyChoice.storeys.length === 1
                  ? void processPolycamLink({ url: storeyChoice.url })
                  : void processPolycamStoreys(storeyChoice.url, stories, storeyChoice.storeys)
              }
            />
          ) : null}

          {showDropzone && !storeyChoice ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitPolycamLink();
              }}
              className="space-y-2.5"
            >
              <div className="flex items-center gap-3 py-1 text-xs font-medium uppercase tracking-[0.08em] text-stone-400" aria-hidden="true">
                <span className="h-px flex-1 bg-stone-200" />
                eller
                <span className="h-px flex-1 bg-stone-200" />
              </div>
              <div className="flex items-center gap-1.5">
                <label htmlFor="polycam-link" className="text-[13px] font-medium text-stone-800">
                  Från en Polycam-skanning
                </label>
                <InfoTip label="Så får du en Polycam-länk">
                  <span className="mb-1.5 block font-medium text-stone-900">Så får du en länk</span>
                  <span className="block">1. Skanna bostaden i Polycams rums- eller planritningsläge (kräver en iPhone eller iPad med LiDAR).</span>
                  <span className="block">2. Öppna skanningen och dela den som en publik länk.</span>
                  <span className="block">3. Klistra in länken här. Har skanningen flera våningar får du välja vilka som ska ritas innan något kostar.</span>
                </InfoTip>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="polycam-link"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={polycamLink}
                  onChange={(event) => setPolycamLink(event.target.value)}
                  placeholder="https://poly.cam/capture/…"
                  className="h-11 w-full min-w-0 rounded-lg sm:w-auto sm:flex-1 border border-stone-200 bg-white px-3.5 text-sm text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.04)] outline-none transition placeholder:text-stone-400 hover:border-stone-300 focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
                <button
                  type="submit"
                  disabled={isSubmitting || isInspecting || polycamLink.trim().length === 0}
                  className={buttonClass("primary", "lg", "sm:min-w-[157px]")}
                >
                  {isInspecting ? "Läser skanningen..." : "Hämta från Polycam"}
                </button>
              </div>
              <p className="text-xs text-stone-500">
                Skanningen måste vara gjord i Polycams rums- eller planritningsläge och delad som
                publik länk.
              </p>
            </form>
          ) : null}

          {errorMessage ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}

          {sourcePreviewUrl ? (
        <div className="space-y-3">
          {!resultPreviewUrl ? (
            <figure className="mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-stone-200 bg-white">
              <figcaption className="flex items-center justify-between gap-3 border-b border-stone-100 bg-stone-50 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Original</span>
                <div className="flex items-center gap-2">
                  {sourceImageId ? (
                    <span className="text-xs font-semibold text-stone-600">
                      {imageDisplayName(sourceImageId)}
                    </span>
                  ) : null}
                  <button
                  type="button"
                  onClick={leavePreview}
                  disabled={isSubmitting}
                  aria-label="Lämna bildvy"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X size={14} aria-hidden="true" />
                </button>
                </div>
              </figcaption>
              <Image
                src={sourcePreviewUrl}
                alt="Original planritning"
                width={1200}
                height={1200}
                unoptimized
                onClick={openSourcePreview}
                className="h-auto w-auto max-h-[min(60vh,640px)] max-w-full cursor-zoom-in bg-white"
              />
              <div className="border-t border-stone-100 bg-stone-50 px-3 pt-3 leading-normal">
                <CompassControl
                  value={plannedCompass}
                  onChange={setPlannedCompass}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 bg-stone-50 px-4 py-3">
                {errorMessage ? (
                  <button
                    type="button"
                    onClick={startConversion}
                    disabled={isSubmitting || !sourcePreviewUrl}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Försök igen
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={startConversion}
                  disabled={isSubmitting || !sourcePreviewUrl}
                  className={buttonClass("primary", "lg", "sm:min-w-[157px]")}
                >
                  {isSubmitting ? "Konverterar..." : "Starta konvertering"}
                </button>
              </div>
            </figure>
          ) : null}

          {showGenerationReview && floors.length > 1 ? (
            <StoreyGallery
              floors={floors}
              activeIndex={activeFloor}
              disabled={isReviewSubmitting}
              onSelect={selectFloor}
              onEnlarge={enlargeFloor}
              onApproveAll={() => void approveAllFloors()}
            />
          ) : null}

          {showGenerationReview ? (
            <figure
              className={`mx-auto overflow-hidden rounded-lg border border-stone-200 bg-white leading-none ${
                isCompareReviewReady ? "w-fit max-w-full" : "w-full max-w-3xl"
              }`}
            >
              <figcaption className="flex items-center justify-between gap-3 border-b border-stone-100 bg-stone-50 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Före / Efter
                </span>
                {resultImageId ? (
                  <span className="text-xs font-semibold text-stone-600">
                    {activeFloor !== null && floors.length > 1 ? `${floors[activeFloor]?.label} · ` : ""}
                    {imageDisplayName(resultImageId)}
                  </span>
                ) : null}
              </figcaption>
              {isComparePreviewLoading ? (
                <ComparePreviewSkeleton showWatermark={protectResultPreview} />
              ) : alignedSourcePreviewUrl && resultPreviewUrl ? (
                <ImageCompareSlider
                  beforeSrc={alignedSourcePreviewUrl}
                  afterSrc={resultPreviewUrl}
                  beforeAlt="Original planritning"
                  afterAlt="Bearbetad planritning"
                  protectAfterImage={protectResultPreview}
                  loadingFallback={<ComparePreviewSkeleton showWatermark={protectResultPreview} />}
                  onReadyChange={handleCompareSliderReadyChange}
                  playEntranceAnimation={!resultImageId || !compassEditedIds.includes(resultImageId)}
                  alignRegion={compareAlignRegion(resultImageId)}
                />
              ) : null}
              {isCompareReviewReady && resultImageId && sheetCompass[resultImageId] ? (
                <div className="border-t border-stone-100 bg-stone-50 px-3 py-3 leading-normal">
                  <CompassControl
                    value={sheetCompass[resultImageId].settings}
                    onChange={changeSheetCompass}
                    disabled={isReviewSubmitting}
                    unavailableReason={
                      sheetCompass[resultImageId].adjustable ? null : sheetCompass[resultImageId].reason ?? null
                    }
                    busy={compassPending}
                  />
                </div>
              ) : null}
              {isCompareReviewReady && alignedSourcePreviewUrl && showRejectForm ? (
                <div className="space-y-3 border-t border-stone-100 bg-stone-50 px-4 py-4">
                  <p className="text-sm font-medium text-stone-700">
                    Beskriv vad som ska bli annorlunda. Kommentaren följer med till den nya
                    konverteringen, så den behövs för att gå vidare.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {REJECT_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={isReviewSubmitting}
                        onClick={() =>
                          setRejectComment((previous) =>
                            previous.trim() ? `${previous.trim()} ${suggestion}.` : `${suggestion}.`,
                          )
                        }
                        className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-700 transition hover:border-stone-300 hover:bg-stone-100 disabled:opacity-60"
                      >
                        + {suggestion}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={rejectComment}
                    onChange={(event) => setRejectComment(event.target.value)}
                    rows={3}
                    placeholder="T.ex. Väggen mellan kök och vardagsrum saknas, och badrummet ska ha ett fönster."
                    disabled={isReviewSubmitting}
                    className="w-full resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-stone-300 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={cancelRejectForm}
                      disabled={isReviewSubmitting}
                      className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Avbryt
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitGenerationReview("reject")}
                      disabled={isReviewSubmitting || !rejectComment.trim()}
                      className={buttonClass("primary", "lg", "sm:min-w-[157px]")}
                    >
                      {isReviewSubmitting ? "Startar..." : "Starta ny konvertering"}
                    </button>
                  </div>
                </div>
              ) : activeFloorApproved ? (
                <p className="border-t border-stone-100 bg-stone-50 px-4 py-4 text-center text-sm font-medium text-[#3f6b3f]">
                  {floors[activeFloor ?? 0]?.label} är godkänd och sparad.
                </p>
              ) : isCompareReviewReady && alignedSourcePreviewUrl ? (
                <div className="border-t border-stone-100 bg-stone-50 px-4 py-4">
                  <p className="mb-3 text-center text-sm font-medium text-stone-700">
                    Godkänner du den bearbetade bilden?
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={openRejectForm}
                      disabled={isReviewSubmitting}
                      className="inline-flex min-w-[157px] items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Konvertera på nytt
                      <RotateCcw size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={openApproveDestinationModal}
                      disabled={isReviewSubmitting}
                      className="inline-flex min-w-[157px] items-center justify-center gap-1.5 rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Godkänn
                      <Check size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : null}
            </figure>
          ) : null}
        </div>
      ) : null}
        </>
      )}

      {sectionOverlayTarget && approveDestinationModal
        ? createPortal(approveDestinationModal, sectionOverlayTarget)
        : approveDestinationModal}

      {previewImageType && activePreviewImageUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={closeImagePreview}
          role="presentation"
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 bg-stone-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={zoomPreviewOut}
                  disabled={previewZoom <= MIN_PREVIEW_ZOOM}
                  aria-label="Zooma ut"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Minus size={15} aria-hidden="true" />
                </button>
                <span className="w-14 text-center text-xs font-semibold text-stone-600">
                  {Math.round(previewZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={zoomPreviewIn}
                  disabled={previewZoom >= MAX_PREVIEW_ZOOM}
                  aria-label="Zooma in"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={resetPreviewZoom}
                  aria-label="Återställ zoom"
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  Reset
                </button>
              </div>

              <button
                type="button"
                onClick={closeImagePreview}
                aria-label="Stäng bildvisning"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 transition hover:bg-stone-100"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-stone-100 p-4">
              <div className="mx-auto flex min-h-full w-full items-center justify-center">
                <div
                  className="relative touch-none select-none transition-transform duration-150"
                  style={{ transform: `scale(${previewZoom})`, transformOrigin: "center center" }}
                  onTouchStart={handlePreviewTouchStart}
                  onTouchMove={handlePreviewTouchMove}
                  onTouchEnd={handlePreviewTouchEnd}
                  onTouchCancel={handlePreviewTouchEnd}
                  onWheel={handlePreviewWheel}
                  onContextMenu={
                    protectResultPreview && previewImageType === "result"
                      ? preventImageContextMenu
                      : undefined
                  }
                >
                  <Image
                    src={activePreviewImageUrl}
                    alt={
                      previewImageType === "source"
                        ? "Original planritning i förhandsvisning"
                        : "Bearbetad planritning i förhandsvisning"
                    }
                    width={2200}
                    height={1600}
                    unoptimized
                    draggable={false}
                    className="h-auto max-h-[calc(90vh-190px)] w-auto max-w-full border border-stone-200 bg-white object-contain"
                  />
                  {protectResultPreview && previewImageType === "result" ? (
                    <WatermarkOverlay />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

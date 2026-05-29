"use client";

import Image from "next/image";
import { Check, Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, DragEvent, TouchEvent, WheelEvent, useCallback, useEffect, useRef, useState } from "react";

import { ImageCompareSlider } from "@/components/dashboard/image-compare-slider";
import { createAlignedCompareImage, parseCompareLayoutFromHeaders } from "@/lib/floorplan-compare-layout";
import {
  CONVERTER_TRANSFER_KEY,
  hasPendingConverterTransfer,
  markStartsidaConverterForReset,
} from "@/lib/startsida-converter-session";
import { supabase } from "@/lib/supabase";

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const UPLOADS_PREFIX = "uploads/";
const GENERATION_EVENTS_EVENT = "generation_events";
const LEGACY_GENERATION_EVENT = "generation-updated";
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.5;
// TODO: tillfälligt 1s — återställ till 10_000
const PROCESSING_MIN_DURATION_MS = 1_000;
const PROCESSING_STEPS = [
  "Laddar upp bild",
  "Analyserar planritning",
  "Identifierar väggar och rum",
  "Förbättrar linjer och kontrast",
  "Genererar slutresultat",
] as const;

type ConverterTransferPayload = {
  previewUrl: string;
  fileName?: string;
  uploadId?: number;
};

function waitForMinimumProcessingDuration(startedAt: number) {
  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(0, PROCESSING_MIN_DURATION_MS - elapsed);
  if (remaining === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, remaining);
  });
}

type ProcessingViewProps = {
  stepIndex: number;
};

function ProcessingView({ stepIndex }: ProcessingViewProps) {
  const progressPercent = Math.round(((stepIndex + 1) / PROCESSING_STEPS.length) * 100);

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-[420px] flex-col items-center justify-center gap-8 px-6 py-12"
    >
      <Loader2 className="h-10 w-10 animate-spin text-[#5c544a]" aria-hidden="true" />

      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-lg font-semibold text-[#4d463f]">Bygger din planritning</p>
          <p className="text-sm text-[#7b746a]">{PROCESSING_STEPS[stepIndex]}...</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-[#7b746a]">
            <span>Förlopp</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-none bg-[#e8e2d8]">
            <div
              className="h-full bg-[#5c544a] transition-all duration-700 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <ul className="space-y-2.5">
          {PROCESSING_STEPS.map((step, index) => {
            const isComplete = index < stepIndex;
            const isActive = index === stepIndex;

            return (
              <li
                key={step}
                className={`flex items-center gap-2.5 text-sm transition-colors ${
                  isComplete || isActive ? "text-[#4d463f]" : "text-[#b8aea0]"
                }`}
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                  {isComplete ? (
                    <Check size={14} className="text-[#5c544a]" aria-hidden="true" />
                  ) : isActive ? (
                    <Loader2 size={14} className="animate-spin text-[#5c544a]" aria-hidden="true" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#d8d2c8]" aria-hidden="true" />
                  )}
                </span>
                <span className={isActive ? "font-medium" : undefined}>{step}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function revokeIfObjectUrl(url: string | null) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
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
  const { data, error } = await supabase
    .from(UPLOADS_TABLE)
    .select("id, file_name, file_path, mime_type")
    .eq("id", uploadId)
    .like("file_path", `${UPLOADS_PREFIX}%`)
    .single();

  if (error || !data?.file_path || !data.mime_type?.startsWith("image/")) {
    return null;
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(data.file_path, 3600);

  if (signError || !signedData?.signedUrl) {
    return null;
  }

  return {
    previewUrl: signedData.signedUrl,
    fileName: data.file_name,
    uploadId: data.id,
  };
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

function extractStoragePathFromSignedUrl(signedUrl: string | null) {
  if (!signedUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(signedUrl);
    const marker = "/object/sign/planritningar/";
    const markerIndex = parsedUrl.pathname.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }

    const encodedPath = parsedUrl.pathname.slice(markerIndex + marker.length);
    if (!encodedPath) {
      return null;
    }

    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}

export function FloorplanEnhancer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [alignedSourcePreviewUrl, setAlignedSourcePreviewUrl] = useState<string | null>(null);
  const [isSourceLoading, setIsSourceLoading] = useState(false);
  const [resultPreviewUrl, setResultPreviewUrl] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingStepIndex, setProcessingStepIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [resultImageId, setResultImageId] = useState<number | null>(null);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showRejectSentConfirmation, setShowRejectSentConfirmation] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false);
  const rejectSentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resultImagePath, setResultImagePath] = useState<string | null>(null);
  const [sourceImageId, setSourceImageId] = useState<number | null>(null);
  const [previewImageType, setPreviewImageType] = useState<"source" | "result" | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  const hasSourcePreview = Boolean(sourcePreviewUrl);
  const showDropzone = !hasSourcePreview;
  const activePreviewImageUrl =
    previewImageType === "source"
      ? sourcePreviewUrl
      : previewImageType === "result"
        ? resultPreviewUrl
        : null;
  const approvedToolsHref =
    resultImageId || resultImagePath
      ? `${pathname.startsWith("/admin") ? "/admin/verktyg" : "/verktyg"}?${new URLSearchParams({
          ...(resultImageId ? { imageId: String(resultImageId), previewImageId: String(resultImageId) } : {}),
          ...(resultImagePath
            ? { imagePath: resultImagePath, previewImagePath: resultImagePath }
            : {}),
        }).toString()}`
      : pathname.startsWith("/admin") ? "/admin/verktyg" : "/verktyg";

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
    async (transferredSource: ConverterTransferPayload, isCancelled: () => boolean) => {
      setIsSourceLoading(true);
      setErrorMessage("");
      setSourceImageId(
        typeof transferredSource.uploadId === "number" ? transferredSource.uploadId : null,
      );
      setSourcePreviewUrl((previous) => {
        revokeIfObjectUrl(previous);
        return transferredSource.previewUrl;
      });

      try {
        const response = await fetch(transferredSource.previewUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Kunde inte hämta vald bild.");
        }

        const blob = await response.blob();
        const file = new File(
          [blob],
          transferredSource.fileName ?? "planritning-fran-uppladdningar.jpg",
          {
            type: blob.type || "image/jpeg",
          },
        );

        if (isCancelled()) {
          return;
        }

        setSourceFile(file);
        clearTransferredSourcePreview();
        clearFromUploadQuery();
      } catch {
        if (!isCancelled()) {
          setErrorMessage("Kunde inte hämta vald bild från uppladdningar. Försök igen.");
        }
      } finally {
        if (!isCancelled()) {
          setIsSourceLoading(false);
        }
      }
    },
    [clearFromUploadQuery],
  );


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

  useEffect(() => {
    return () => {
      if (rejectSentTimeoutRef.current) {
        clearTimeout(rejectSentTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSubmitting) {
      setProcessingStepIndex(0);
      return;
    }

    const stepDuration = PROCESSING_MIN_DURATION_MS / PROCESSING_STEPS.length;
    const intervalId = window.setInterval(() => {
      setProcessingStepIndex((previous) =>
        previous < PROCESSING_STEPS.length - 1 ? previous + 1 : previous,
      );
    }, stepDuration);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isSubmitting]);

  function clearGenerationResult() {
    setPreviewImageType(null);
    setPreviewZoom(1);
    setResultImageId(null);
    setResultImagePath(null);
    setShowRejectForm(false);
    setRejectComment("");
    setIsReviewSubmitting(false);
    setAlignedSourcePreviewUrl(null);
    setResultPreviewUrl((prev) => {
      revokeIfObjectUrl(prev);

      return null;
    });
  }

  function resetResult() {
    setShowRejectSentConfirmation(false);
    if (rejectSentTimeoutRef.current) {
      clearTimeout(rejectSentTimeoutRef.current);
      rejectSentTimeoutRef.current = null;
    }
    clearGenerationResult();
  }

  function resetSourceSelection() {
    setErrorMessage("");
    setIsSubmitting(false);
    setSourceFile(null);
    setSourceImageId(null);
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

  useEffect(() => {
    return () => {
      markStartsidaConverterForReset();
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function hydrateTransferredSource() {
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

      if (transferredSource?.previewUrl) {
        await applyTransferredSource(transferredSource, () => isCancelled);
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
    setSourceFile(file);
    setSourceImageId(null);
    setSourcePreviewUrl((prev) => {
      revokeIfObjectUrl(prev);
      return URL.createObjectURL(file);
    });
    resetResult();
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

  async function processImage(file: File) {
    if (isSubmitting) {
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);
    setProcessingStepIndex(0);
    const processingStartedAt = Date.now();

    try {
      const payload = new FormData();
      payload.append("file", file);
      if (sourceImageId) {
        payload.append("sourceImageId", String(sourceImageId));
      }

      const response = await fetch("/api/convert", {
        method: "POST",
        body: payload,
      });

      if (!response.ok) {
        const fallbackMessage = "Kunde inte bearbeta bilden. Försök igen.";
        let resolvedMessage = fallbackMessage;
        try {
          const data = (await response.json()) as { message?: string };
          if (data?.message) {
            resolvedMessage = data.message;
          }
        } catch {
          // Ignore JSON parse issues and use fallback message.
        }
        throw new Error(resolvedMessage);
      }

      await waitForMinimumProcessingDuration(processingStartedAt);

      const savedImageIdHeader = response.headers.get("x-saved-image-id");
      const savedImagePath = response.headers.get("x-saved-image-path");
      const savedImageUrl = response.headers.get("x-saved-image-url");
      const sourceImageIdHeader = response.headers.get("x-source-image-id");
      const parsedSavedImageId =
        savedImageIdHeader && !Number.isNaN(Number(savedImageIdHeader))
          ? Number(savedImageIdHeader)
          : null;
      const parsedSourceImageId =
        sourceImageIdHeader && !Number.isNaN(Number(sourceImageIdHeader))
          ? Number(sourceImageIdHeader)
          : null;
      if (parsedSourceImageId) {
        setSourceImageId(parsedSourceImageId);
      }
      setResultImageId(parsedSavedImageId);
      setResultImagePath(savedImagePath ?? extractStoragePathFromSignedUrl(savedImageUrl));
      const compareLayout = parseCompareLayoutFromHeaders(response.headers);
      if (compareLayout) {
        try {
          const alignedPreview = await createAlignedCompareImage(file, compareLayout);
          setAlignedSourcePreviewUrl(alignedPreview);
        } catch {
          setAlignedSourcePreviewUrl(null);
        }
      } else {
        setAlignedSourcePreviewUrl(null);
      }
      const resultBlob = await response.blob();
      setResultPreviewUrl((prev) => {
        revokeIfObjectUrl(prev);

        if (savedImageUrl) {
          return savedImageUrl;
        }

        return URL.createObjectURL(resultBlob);
      });
      window.dispatchEvent(new Event("library-updated"));
      window.dispatchEvent(new Event(GENERATION_EVENTS_EVENT));
      window.dispatchEvent(new Event(LEGACY_GENERATION_EVENT));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ett oväntat fel uppstod.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function startConversion() {
    if (isSubmitting) {
      return;
    }

    if (!sourceFile && sourcePreviewUrl?.startsWith("data:")) {
      const restoredFile = dataUrlToFile(sourcePreviewUrl);
      if (restoredFile) {
        setSourceFile(restoredFile);
        void processImage(restoredFile);
        return;
      }
    }

    if (!sourceFile) {
      setErrorMessage("Kunde inte läsa bilden igen. Ladda upp bilden på nytt.");
      return;
    }

    void processImage(sourceFile);
  }

  async function submitGenerationReview(action: "approve" | "reject") {
    if (isReviewSubmitting || !resultImageId || !resultImagePath) {
      return;
    }

    const trimmedComment = rejectComment.trim();
    if (action === "reject" && !trimmedComment) {
      setErrorMessage("Skriv en kommentar om varför bilden nekas.");
      return;
    }

    setErrorMessage("");
    setIsReviewSubmitting(true);

    try {
      const response = await fetch("/api/review-generation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          imageId: resultImageId,
          filePath: resultImagePath,
          ...(action === "reject" ? { comment: trimmedComment } : {}),
        }),
      });

      if (!response.ok) {
        const fallbackMessage =
          action === "approve"
            ? "Kunde inte godkänna bilden just nu."
            : "Kunde inte neka bilden just nu.";
        let resolvedMessage = fallbackMessage;
        try {
          const data = (await response.json()) as { message?: string };
          if (data?.message) {
            resolvedMessage = data.message;
          }
        } catch {
          // Ignore JSON parse issues and use fallback message.
        }
        throw new Error(resolvedMessage);
      }

      if (action === "approve") {
        setShowRejectForm(false);
        setRejectComment("");
        router.push(approvedToolsHref);
        return;
      }

      clearGenerationResult();
      setShowRejectSentConfirmation(true);
      window.dispatchEvent(new Event("library-updated"));
      window.dispatchEvent(new Event(GENERATION_EVENTS_EVENT));
      window.dispatchEvent(new Event(LEGACY_GENERATION_EVENT));

      if (rejectSentTimeoutRef.current) {
        clearTimeout(rejectSentTimeoutRef.current);
      }
      rejectSentTimeoutRef.current = setTimeout(() => {
        rejectSentTimeoutRef.current = null;
        setShowRejectSentConfirmation(false);
      }, 2500);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ett oväntat fel uppstod.");
    } finally {
      setIsReviewSubmitting(false);
    }
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

  function openResultPreview() {
    if (!resultPreviewUrl) {
      return;
    }

    setPreviewZoom(1);
    setPreviewImageType("result");
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

  useEffect(() => {
    if (!previewImageType) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeImagePreview();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [previewImageType]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 rounded-none border border-[#d8d2c8] bg-white p-5 text-left text-[#4d463f] shadow-sm">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="sr-only"
        onChange={handleFileInputChange}
      />

      {isSubmitting ? (
        <ProcessingView stepIndex={processingStepIndex} />
      ) : (
        <>
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
              className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-none border-2 border-dashed px-6 py-8 text-center transition ${
                isDragActive
                  ? "border-[#b8aea0] bg-[#f2ede5]"
                  : "border-[#d8d2c8] bg-[#faf8f4] hover:border-[#b8aea0]"
              }`}
            >
              <p className="text-sm font-medium text-[#5c544a]">
                Dra och släpp en planritning här, eller klicka för att välja fil.
              </p>
              <p className="mt-2 text-xs text-[#7b746a]">Stöd: PNG, JPG, WEBP</p>
            </label>
          ) : null}

          {errorMessage ? (
            <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}

          {sourcePreviewUrl ? (
        <div className="space-y-3">
          {!resultPreviewUrl ? (
            <figure className="mx-auto w-fit max-w-full overflow-hidden rounded-none border border-[#d8d2c8] bg-white">
              <figcaption className="flex items-center justify-between gap-3 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#7b746a]">Original</span>
                <button
                  type="button"
                  onClick={leavePreview}
                  disabled={isSubmitting}
                  aria-label="Lämna bildvy"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X size={14} aria-hidden="true" />
                </button>
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
            </figure>
          ) : null}

          {resultPreviewUrl && sourcePreviewUrl ? (
            <figure className="mx-auto w-fit max-w-full overflow-hidden rounded-none border border-[#d8d2c8] bg-white leading-none">
              <figcaption className="relative flex items-center justify-between gap-3 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#7b746a]">
                  Före / Efter
                </span>
                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-[#6a6258]">
                  {resultImageId ? `Bild ${resultImageId}` : ""}
                </span>
              </figcaption>
              <ImageCompareSlider
                beforeSrc={alignedSourcePreviewUrl ?? sourcePreviewUrl}
                afterSrc={resultPreviewUrl}
                beforeAlt="Original planritning"
                afterAlt="Bearbetad planritning"
                onClick={openResultPreview}
                className="cursor-zoom-in"
              />
            </figure>
          ) : null}

          <div className="mx-auto w-full max-w-3xl">
            <div className="relative mt-1 flex flex-col gap-3">
              {!resultPreviewUrl ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {showRejectSentConfirmation ? (
                    <div
                      aria-live="polite"
                      className="inline-flex min-w-[157px] items-center justify-center rounded-none border border-[#d8d2c8] bg-[#f7f4ef] px-3 py-2 text-sm font-medium text-[#4d463f]"
                    >
                      Ditt meddelande är skickat.
                    </div>
                  ) : (
                    <>
                      {errorMessage ? (
                        <button
                          type="button"
                          onClick={startConversion}
                          disabled={isSubmitting || !sourceFile}
                          className="rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f7f4ef] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Försök igen
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={startConversion}
                        disabled={isSubmitting || isSourceLoading || !sourceFile}
                        className="inline-flex min-w-[157px] items-center justify-center rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSubmitting
                          ? "Konverterar..."
                          : isSourceLoading
                            ? "Laddar bild..."
                            : "Starta konvertering"}
                      </button>
                    </>
                  )}
                </div>
              ) : showRejectForm ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-[#5c544a]">
                    Berätta varför bilden nekas så att vi kan förbättra resultatet.
                  </p>
                  <textarea
                    value={rejectComment}
                    onChange={(event) => setRejectComment(event.target.value)}
                    rows={3}
                    placeholder="Skriv din kommentar här..."
                    disabled={isReviewSubmitting}
                    className="w-full resize-y rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm text-[#4d463f] outline-none transition focus:border-[#b8aea0] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelRejectForm}
                      disabled={isReviewSubmitting}
                      className="rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Avbryt
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitGenerationReview("reject")}
                      disabled={isReviewSubmitting || !rejectComment.trim()}
                      className="inline-flex min-w-[157px] items-center justify-center rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isReviewSubmitting ? "Skickar..." : "Skicka"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-center text-sm font-medium text-[#5c544a]">
                    Godkänner du den bearbetade bilden?
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={openRejectForm}
                      disabled={isReviewSubmitting}
                      className="inline-flex min-w-[157px] items-center justify-center gap-1.5 rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Nej
                      <X size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitGenerationReview("approve")}
                      disabled={isReviewSubmitting}
                      className="inline-flex min-w-[157px] items-center justify-center gap-1.5 rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isReviewSubmitting ? "Sparar..." : "Godkänn"}
                      <Check size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
        </>
      )}

      {previewImageType && activePreviewImageUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={closeImagePreview}
          role="presentation"
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-none border border-[#d8d2c8] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={zoomPreviewOut}
                  disabled={previewZoom <= MIN_PREVIEW_ZOOM}
                  aria-label="Zooma ut"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Minus size={15} aria-hidden="true" />
                </button>
                <span className="w-14 text-center text-xs font-semibold text-[#6a6258]">
                  {Math.round(previewZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={zoomPreviewIn}
                  disabled={previewZoom >= MAX_PREVIEW_ZOOM}
                  aria-label="Zooma in"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={resetPreviewZoom}
                  aria-label="Återställ zoom"
                  className="inline-flex h-8 items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  Reset
                </button>
              </div>

              <button
                type="button"
                onClick={closeImagePreview}
                aria-label="Stäng bildvisning"
                className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5]"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-[#f0ece6] p-4">
              <div className="mx-auto flex min-h-full w-full items-center justify-center">
                <div
                  className="touch-none select-none"
                  onTouchStart={handlePreviewTouchStart}
                  onTouchMove={handlePreviewTouchMove}
                  onTouchEnd={handlePreviewTouchEnd}
                  onTouchCancel={handlePreviewTouchEnd}
                  onWheel={handlePreviewWheel}
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
                    className="h-auto max-h-[calc(90vh-190px)] w-auto max-w-full border border-[#d8d2c8] bg-white object-contain transition-transform duration-150"
                    style={{ transform: `scale(${previewZoom})`, transformOrigin: "center center" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

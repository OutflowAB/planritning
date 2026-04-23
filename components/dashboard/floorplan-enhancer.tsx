"use client";

import Image from "next/image";
import Link from "next/link";
import { Download, Minus, Plus, RotateCcw, X } from "lucide-react";
import { ChangeEvent, DragEvent, TouchEvent, WheelEvent, useEffect, useRef, useState } from "react";

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const SOURCE_PREVIEW_CACHE_KEY = "floorplan-source-preview-v1";
const SOURCE_PREVIEW_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CONVERTER_TRANSFER_KEY = "converter-selected-upload-v1";
const GENERATION_EVENTS_EVENT = "generation_events";
const LEGACY_GENERATION_EVENT = "generation-updated";
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.5;

type ProcessingStatus = "idle" | "uploading" | "processing" | "error";
type SourcePreviewCachePayload = {
  dataUrl: string;
  expiresAt: number;
};

type ConverterTransferPayload = {
  previewUrl: string;
  fileName?: string;
  uploadId?: number;
};

function statusLabel(status: ProcessingStatus): string {
  if (status === "uploading") {
    return "Laddar upp...";
  }

  if (status === "processing") {
    return "Bearbetar bild...";
  }

  return "";
}

function revokeIfObjectUrl(url: string | null) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function readCachedSourcePreview() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawCache = window.localStorage.getItem(SOURCE_PREVIEW_CACHE_KEY);
  if (!rawCache) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawCache) as SourcePreviewCachePayload;
    if (
      typeof parsed?.dataUrl !== "string" ||
      typeof parsed?.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      window.localStorage.removeItem(SOURCE_PREVIEW_CACHE_KEY);
      return null;
    }

    return parsed.dataUrl;
  } catch {
    window.localStorage.removeItem(SOURCE_PREVIEW_CACHE_KEY);
    return null;
  }
}

function cacheSourcePreview(dataUrl: string) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: SourcePreviewCachePayload = {
    dataUrl,
    expiresAt: Date.now() + SOURCE_PREVIEW_CACHE_TTL_MS,
  };

  try {
    window.localStorage.setItem(SOURCE_PREVIEW_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors and continue without cache.
  }
}

function clearCachedSourcePreview() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SOURCE_PREVIEW_CACHE_KEY);
}

function readTransferredSourcePreview() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawPayload = window.sessionStorage.getItem(CONVERTER_TRANSFER_KEY);
  if (!rawPayload) {
    return null;
  }

  window.sessionStorage.removeItem(CONVERTER_TRANSFER_KEY);

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

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Kunde inte läsa filen."));
    };
    reader.onerror = () => reject(new Error("Kunde inte läsa filen."));
    reader.readAsDataURL(file);
  });
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
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [resultPreviewUrl, setResultPreviewUrl] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isResultDownloading, setIsResultDownloading] = useState(false);
  const [resultImageId, setResultImageId] = useState<number | null>(null);
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
  const savedToLibraryHref =
    resultImageId || resultImagePath
      ? `/planritningar?${new URLSearchParams({
          ...(resultImageId ? { imageId: String(resultImageId), previewImageId: String(resultImageId) } : {}),
          ...(resultImagePath
            ? { imagePath: resultImagePath, previewImagePath: resultImagePath }
            : {}),
        }).toString()}`
      : "/planritningar";

  useEffect(() => {
    let isCancelled = false;

    async function hydrateInitialSource() {
      const transferredSource = readTransferredSourcePreview();
      if (transferredSource?.previewUrl) {
        try {
          const response = await fetch(transferredSource.previewUrl, { cache: "no-store" });
          if (!response.ok) {
            throw new Error("Kunde inte hämta vald bild.");
          }

          const blob = await response.blob();
          const file = new File([blob], transferredSource.fileName ?? "planritning-fran-uppladdningar.jpg", {
            type: blob.type || "image/jpeg",
          });
          const objectUrl = URL.createObjectURL(file);

          if (isCancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }

          setErrorMessage("");
          setSourceFile(file);
          setSourceImageId(
            typeof transferredSource.uploadId === "number" ? transferredSource.uploadId : null,
          );
          setSourcePreviewUrl((prev) => {
            revokeIfObjectUrl(prev);
            return objectUrl;
          });
          void fileToDataUrl(file).then(cacheSourcePreview).catch(() => undefined);
          return;
        } catch {
          // Fall back to cached source if transfer fetch fails.
        }
      }

      const cachedPreview = readCachedSourcePreview();
      if (!cachedPreview || isCancelled) {
        return;
      }

      setSourcePreviewUrl(cachedPreview);
      setSourceImageId(null);
      const cachedFile = dataUrlToFile(cachedPreview);
      if (cachedFile) {
        setSourceFile(cachedFile);
      }
    }

    void hydrateInitialSource();
    return () => {
      isCancelled = true;
    };
  }, []);

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

  function resetResult() {
    setPreviewImageType(null);
    setPreviewZoom(1);
    setResultImageId(null);
    setResultImagePath(null);
    setResultPreviewUrl((prev) => {
      revokeIfObjectUrl(prev);

      return null;
    });
    setStatus("idle");
  }

  function resetSourceSelection() {
    setErrorMessage("");
    setIsSubmitting(false);
    setStatus("idle");
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
    clearCachedSourcePreview();
    resetResult();
  }

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
    void fileToDataUrl(file).then(cacheSourcePreview).catch(() => undefined);
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
    setStatus("uploading");

    try {
      const payload = new FormData();
      payload.append("file", file);
      if (sourceImageId) {
        payload.append("sourceImageId", String(sourceImageId));
      }

      const requestPromise = fetch("/api/convert", {
        method: "POST",
        body: payload,
      });

      await new Promise((resolve) => {
        window.setTimeout(resolve, 250);
      });
      setStatus("processing");

      const response = await requestPromise;
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
      const resultBlob = await response.blob();
      setResultPreviewUrl((prev) => {
        revokeIfObjectUrl(prev);

        if (savedImageUrl) {
          return savedImageUrl;
        }

        return URL.createObjectURL(resultBlob);
      });
      setStatus("idle");
      window.dispatchEvent(new Event("library-updated"));
      window.dispatchEvent(new Event(GENERATION_EVENTS_EVENT));
      window.dispatchEvent(new Event(LEGACY_GENERATION_EVENT));
    } catch (error) {
      setStatus("error");
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

  async function downloadResultImage() {
    if (!resultPreviewUrl || isResultDownloading) {
      return;
    }

    setIsResultDownloading(true);
    try {
      const response = await fetch(resultPreviewUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Download failed");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "planritning-bearbetad.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch {
      setErrorMessage("Kunde inte ladda ner bilden just nu.");
    } finally {
      setIsResultDownloading(false);
    }
  }

  function startNewImageSelection() {
    if (isSubmitting) {
      return;
    }

    resetSourceSelection();
    fileInputRef.current?.click();
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

      {showDropzone ? (
        <label
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => {
            if (isSubmitting) {
              return;
            }
            fileInputRef.current?.click();
          }}
          onKeyDown={(event) => {
            if (isSubmitting) {
              return;
            }

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

      {isSubmitting && statusLabel(status) ? (
        <p aria-live="polite" className="text-sm font-medium text-[#6a6258]">
          {statusLabel(status)}
        </p>
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

          {resultPreviewUrl ? (
            <figure className="mx-auto w-fit max-w-full overflow-hidden rounded-none border border-[#d8d2c8] bg-white">
              <figcaption className="relative flex items-center justify-between gap-3 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#7b746a]">Resultat</span>
                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-[#6a6258]">
                  {resultImageId ? `Bild ${resultImageId}` : ""}
                </span>
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
                src={resultPreviewUrl}
                alt="Bearbetad planritning"
                width={1200}
                height={1200}
                unoptimized
                onClick={openResultPreview}
                className="h-auto w-auto max-h-[min(60vh,640px)] max-w-full cursor-zoom-in bg-white"
              />
            </figure>
          ) : null}

          <div className="mx-auto w-full max-w-3xl">
            <div className="relative mt-1 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={startNewImageSelection}
                disabled={isSubmitting}
                className="inline-flex min-w-[157px] items-center justify-center rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Ladda upp ny bild
              </button>

              {resultPreviewUrl ? (
                <Link
                  href={savedToLibraryHref}
                  className="absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-[#6a6258] underline decoration-[#b8aea0] underline-offset-4 transition hover:text-[#4d463f]"
                >
                  Bilden har sparats till Planritningar
                </Link>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2">
                {!resultPreviewUrl ? (
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
                      disabled={isSubmitting || (!sourceFile && !sourcePreviewUrl)}
                      className="inline-flex min-w-[157px] items-center justify-center rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? "Konverterar..." : "Starta konvertering"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void downloadResultImage()}
                    disabled={isResultDownloading}
                    className="inline-flex min-w-[157px] items-center justify-center gap-1.5 rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Download size={14} aria-hidden="true" />
                    {isResultDownloading ? "Laddar..." : "Ladda ner"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

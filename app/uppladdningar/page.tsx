"use client";

import { Download, Loader2, Minus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, DragEvent, TouchEvent, WheelEvent, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { isAuthenticated } from "@/lib/auth";
import {
  imageDisplayName,
  resolveImageDownloadFileName,
} from "@/lib/image-naming";
import { ThumbnailImage } from "@/components/ui/thumbnail-image";
import { apiFetch, apiJson, describeError } from "@/lib/api-client";
import { imageUrl } from "@/lib/image-url";
import { prefetchImage } from "@/lib/prefetch-image";
import { dispatchGenerationUpdated, LIBRARY_UPDATED_EVENT, subscribeToAppEvent } from "@/lib/app-events";
import { useCachedList } from "@/lib/use-cached-list";
import type { ImageListItem } from "@/app/api/images/route";
import {
  hasUnfinishedConverterSession,
  subscribeUnfinishedConverterSession,
} from "@/lib/startsida-converter-session";
import { useToast } from "@/components/ui/toast-provider";

const UPLOADS_LIST_CACHE_KEY = "uploads-list-cache-v2";
const CONVERTER_TRANSFER_KEY = "converter-selected-upload-v1";
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.5;

type UploadedImageRow = {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string | null;
  created_at: string;
  version: string | null;
  preview_url: string | null;
  full_url: string | null;
};

function withImageUrls(item: ImageListItem): UploadedImageRow {
  const isImage = item.mime_type?.startsWith("image/") ?? false;
  return {
    id: item.id,
    file_name: item.file_name,
    file_path: item.file_path,
    file_size: item.file_size,
    mime_type: item.mime_type,
    created_at: item.created_at,
    version: item.version,
    preview_url: isImage ? imageUrl(item.id, "thumb", item.version) : null,
    full_url: isImage ? imageUrl(item.id, "full", item.version) : null,
  };
}

async function fetchUploads(signal: AbortSignal): Promise<UploadedImageRow[]> {
  const { items } = await apiJson<{ items: ImageListItem[] }>("/api/images?kind=uploads", { signal });
  return items.map(withImageUrls);
}

type ConverterTransferPayload = {
  previewUrl: string;
  fileName: string;
  uploadId: number;
};

function useHasUnfinishedConverterSession() {
  return useSyncExternalStore(
    subscribeUnfinishedConverterSession,
    () => hasUnfinishedConverterSession(),
    () => false,
  );
}

export default function UppladdningarPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const isConverterSessionUnfinished = useHasUnfinishedConverterSession();
  const canDelete = isAuthenticated();
  const converterPath = pathname.startsWith("/admin") ? "/admin/dashboard" : "/startsida";
  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    items: uploads,
    setItems: setUploads,
    isLoading: isLoadingUploads,
    isRefreshing: isRefreshingUploads,
    error: uploadsLoadError,
    reload: reloadUploads,
  } = useCachedList<UploadedImageRow>(UPLOADS_LIST_CACHE_KEY, fetchUploads, "Kunde inte hämta uppladdningar.");
  const uploadsLoadFailed = uploadsLoadError !== null;
  const [selectedUploadIds, setSelectedUploadIds] = useState<number[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [loadedPreviewIds, setLoadedPreviewIds] = useState<Record<number, boolean>>({});
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isPreviewDownloading, setIsPreviewDownloading] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const previewImageId = searchParams.get("previewImageId");
  const previewImage = uploads.find((upload) => String(upload.id) === previewImageId);

  function setQueryParam(paramName: string, value?: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(paramName, value);
    } else {
      params.delete(paramName);
    }
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function openImagePreview(imageId: number) {
    setPreviewZoom(1);
    setQueryParam("previewImageId", String(imageId));
  }

  function goToConverter(upload: UploadedImageRow) {
    if (isConverterSessionUnfinished) {
      showToast("Slutför den påbörjade konverteringen först.", "error");
      return;
    }

    if (upload.preview_url) {
      const payload: ConverterTransferPayload = {
        previewUrl: upload.preview_url,
        fileName: resolveImageDownloadFileName(upload.id, {
          mimeType: upload.mime_type,
          filePath: upload.file_path,
        }),
        uploadId: upload.id,
      };
      window.sessionStorage.setItem(CONVERTER_TRANSFER_KEY, JSON.stringify(payload));
    }

    const params = new URLSearchParams();
    params.set("fromUpload", String(upload.id));
    router.push(`${converterPath}?${params.toString()}`);
  }

  function closeImagePreview() {
    setPreviewZoom(1);
    setQueryParam("previewImageId");
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
    // Trackpad pinch gestures are emitted as wheel+ctrl in many browsers.
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

  async function downloadPreviewImage() {
    if (!previewImage?.preview_url) {
      return;
    }

    setIsPreviewDownloading(true);
    try {
      const response = await fetch(previewImage.preview_url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Download failed");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = resolveImageDownloadFileName(previewImage.id, {
        mimeType: previewImage.mime_type,
        filePath: previewImage.file_path,
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch {
      showToast("Kunde inte ladda ner bilden just nu.", "error");
    } finally {
      setIsPreviewDownloading(false);
    }
  }

  function toggleUploadSelection(uploadId: number) {
    setSelectedUploadIds((previous) =>
      previous.includes(uploadId)
        ? previous.filter((id) => id !== uploadId)
        : [...previous, uploadId],
    );
  }

  function toggleSelectAllUploads() {
    setSelectedUploadIds((previous) =>
      previous.length === uploads.length ? [] : uploads.map((upload) => upload.id),
    );
  }

  function enterSelectionMode() {
    setIsSelectionMode(true);
    setSelectedUploadIds([]);
  }

  function exitSelectionMode() {
    setIsSelectionMode(false);
    setSelectedUploadIds([]);
  }

  async function handleDeleteSelectedUploads() {
    if (!canDelete || isDeletingSelected || selectedUploadIds.length === 0) {
      return;
    }

    setIsDeletingSelected(true);

    const selectedUploads = uploads.filter((upload) => selectedUploadIds.includes(upload.id));

    try {
      const response = await apiFetch("/api/delete-uploads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: selectedUploads.map((upload) => ({
            id: upload.id,
            filePath: upload.file_path,
          })),
        }),
      });
      const data = (await response.json()) as {
        deletedIds?: number[];
        failedCount?: number;
        message?: string;
      };

      const deletedIds = data.deletedIds ?? [];
      const failedCount = data.failedCount ?? 0;

      if (deletedIds.length > 0) {
        if (previewImage && deletedIds.includes(previewImage.id)) {
          closeImagePreview();
        }

        setUploads((previous) => previous.filter((entry) => !deletedIds.includes(entry.id)));
        setSelectedUploadIds((previous) => {
          const remaining = previous.filter((id) => !deletedIds.includes(id));
          if (remaining.length === 0) {
            setIsSelectionMode(false);
          }
          return remaining;
        });
        showToast(
          deletedIds.length === 1
            ? "1 uppladdning raderades."
            : `${deletedIds.length} uppladdningar raderades.`,
        );
        reloadUploads();
        dispatchGenerationUpdated();
      }

      if (!response.ok && deletedIds.length === 0) {
        showToast(data.message ?? "Kunde inte ta bort markerade uppladdningar.", "error");
      } else if (failedCount > 0) {
        const detail = data.message ? ` ${data.message}` : "";
        showToast(
          failedCount === 1
            ? data.message ?? "Kunde inte ta bort en markerad uppladdning."
            : `Kunde inte ta bort ${failedCount} markerade uppladdningar.${detail}`,
          "error",
        );
      }
    } catch {
      showToast("Kunde inte ta bort markerade uppladdningar just nu.", "error");
    } finally {
      setIsDeletingSelected(false);
    }
  }


  useEffect(() => subscribeToAppEvent(LIBRARY_UPDATED_EVENT, reloadUploads), [reloadUploads]);

  // A selection cannot outlive the rows it points at.
  useEffect(() => {
    queueMicrotask(() => {
      setSelectedUploadIds((previous) => previous.filter((id) => uploads.some((row) => row.id === id)));
    });
  }, [uploads]);

  const closeImagePreviewRef = useRef(closeImagePreview);
  useLayoutEffect(() => {
    closeImagePreviewRef.current = closeImagePreview;
  });

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeImagePreviewRef.current();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [previewImage]);

  useEffect(() => {
    // Reconciles the sticky "loaded" flags with the current rows. Queued so the update stays
    // out of the effect body; it is not paint-critical.
    queueMicrotask(() => {
      setLoadedPreviewIds((previous) => {
        const next: Record<number, boolean> = {};
        uploads.forEach((upload) => {
          const alreadyLoaded = previous[upload.id] ?? false;
          next[upload.id] = upload.preview_url ? alreadyLoaded : true;
        });
        return next;
      });
    });
  }, [uploads]);

  async function uploadFile(file: File) {
    if (isUploading) {
      return;
    }

    setIsUploading(true);

    try {
      const payload = new FormData();
      payload.append("file", file);
      await apiFetch("/api/upload", { method: "POST", body: payload });

      showToast("Bilden laddades upp.");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      reloadUploads();
    } catch (error) {
      const message = describeError(error, "Ett oväntat fel uppstod under uppladdning.");
      if (message) {
        showToast(message, "error");
      }
    } finally {
      setIsUploading(false);
    }
  }

  function assignUploadFile(file: File | null) {
    if (!file || !file.type.startsWith("image/")) {
      showToast("Välj en bildfil (PNG, JPG eller WEBP).", "error");
      return;
    }

    void uploadFile(file);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    assignUploadFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);
    assignUploadFile(event.dataTransfer.files?.[0] ?? null);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);
  }

  return (
    <section className="relative flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex w-full max-w-4xl flex-col gap-6">
        <div className="rounded-none border border-[#d8d2c8] bg-white p-4 shadow-sm sm:p-6">
          <label
            htmlFor="image-file"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-none border-2 border-dashed px-6 py-8 text-center transition ${
              isDragActive
                ? "border-[#b8aea0] bg-[#f2ede5]"
                : "border-[#d8d2c8] bg-[#faf8f4]"
            } ${isUploading ? "pointer-events-none opacity-70" : ""}`}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-[#5c544a]" aria-hidden="true" />
                <p className="mt-4 text-base font-medium text-[#6a6258]">Laddar upp...</p>
              </>
            ) : (
              <>
                <p className="text-base font-medium text-[#6a6258]">
                  Dra och släpp din planritning här
                </p>
                <p className="mt-2 text-base text-[#6a6258]">
                  eller{" "}
                  <span className="font-semibold underline decoration-[#4d463f] underline-offset-4">
                    bläddra bland filer
                  </span>
                </p>
              </>
            )}
          </label>
          <input
            ref={fileInputRef}
            id="image-file"
            type="file"
            accept="image/*"
            onChange={handleFileInputChange}
            disabled={isUploading}
            className="sr-only"
          />
        </div>

        <div className="rounded-none border border-[#d8d2c8] bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-[#3d3a36]">Uppladdningar</h1>
            </div>
            <div className="flex items-center gap-2">
              {canDelete && isSelectionMode ? (
                <>
                  <button
                    type="button"
                    onClick={exitSelectionMode}
                    disabled={isDeletingSelected}
                    className="rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Avbryt
                  </button>
                  <button
                    type="button"
                    onClick={toggleSelectAllUploads}
                    disabled={isDeletingSelected || uploads.length === 0}
                    className="rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {selectedUploadIds.length === uploads.length && uploads.length > 0
                      ? "Avmarkera alla"
                      : "Markera alla"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSelectedUploads()}
                    disabled={isDeletingSelected || selectedUploadIds.length === 0}
                    className="inline-flex items-center gap-1 rounded-none border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 size={12} aria-hidden="true" />
                    {isDeletingSelected
                      ? "Tar bort..."
                      : `Ta bort (${selectedUploadIds.length})`}
                  </button>
                </>
              ) : null}
              {canDelete && !isSelectionMode && uploads.length > 0 ? (
                <button
                  type="button"
                  onClick={enterSelectionMode}
                  className="rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
                >
                  Välj
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-8">
            {isLoadingUploads ? (
              <div className="flex items-center justify-center gap-2 rounded-none border border-[#d8d2c8] bg-[#f7f4ef] px-4 py-6 text-[#6a6258]">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                <p className="text-sm font-medium">Hämtar uppladdningar...</p>
              </div>
            ) : null}

            {isRefreshingUploads ? (
              <p
                className="mb-3 inline-flex items-center gap-1.5 text-xs text-[#7b746a]"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Uppdaterar listan...
              </p>
            ) : null}

            {!isLoadingUploads && !uploadsLoadFailed && uploads.length === 0 ? (
              <p className="mt-3 text-sm text-[#6a6258]">Inga uppladdningar finns ännu.</p>
            ) : null}

            {!isLoadingUploads && uploads.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {uploads.map((upload, uploadIndex) => {
                const isPreviewReady = !upload.preview_url || loadedPreviewIds[upload.id];
                const isMarked = selectedUploadIds.includes(upload.id);

                return (
                <article
                  key={upload.id}
                  className={`overflow-hidden rounded-none border bg-white ${
                    isMarked
                      ? "border-[#8b7355] shadow-[0_0_0_2px_rgba(139,115,85,0.2)]"
                      : "border-[#d8d2c8]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
                    <p className="text-xs font-medium text-[#7b746a]">
                      {new Date(upload.created_at).toLocaleString("sv-SE")}
                    </p>
                    <div className="ml-auto flex items-center gap-2">
                      <p className="text-xs font-semibold text-[#6a6258]">Bild {upload.id}</p>
                      {!isPreviewReady ? (
                        <span className="inline-flex items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#7b746a]">
                          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                          Laddar...
                        </span>
                      ) : null}
                      {canDelete && isSelectionMode ? (
                        <label className="inline-flex items-center">
                          <input
                            type="checkbox"
                            checked={isMarked}
                            onChange={() => toggleUploadSelection(upload.id)}
                            disabled={isDeletingSelected}
                            className="h-5 w-5 rounded border-[#b7aea1] text-[#8b7355] focus:ring-[#8b7355]"
                          />
                        </label>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center justify-center bg-[#f0ece6] p-4">
                    <button
                      type="button"
                      onClick={() => {
                        if (isSelectionMode && canDelete) {
                          toggleUploadSelection(upload.id);
                          return;
                        }
                        openImagePreview(upload.id);
                      }}
                      disabled={!upload.preview_url}
                      className={`block w-full disabled:cursor-default ${
                        isSelectionMode && canDelete ? "cursor-pointer" : "cursor-zoom-in"
                      }`}
                    >
                      <ThumbnailImage
                        src={upload.preview_url}
                        alt={imageDisplayName(upload.id)}
                        onPrefetch={() => prefetchImage(upload.full_url)}
                        heightClassName="h-[220px]"
                        sizes={"(max-width: 768px) 90vw, (max-width: 1280px) 45vw, 30vw"}
                        priority={uploadIndex < 3}
                        onLoad={() =>
                          setLoadedPreviewIds((previous) => ({
                            ...previous,
                            [upload.id]: true,
                          }))
                        }
                      />
                    </button>
                  </div>
                </article>
                );
              })}
            </div>
          ) : null}
          </div>
        </div>
      </div>

      {previewImage?.preview_url ? (
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

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#6a6258]">Bild {previewImage.id}</span>
                <button
                  type="button"
                  onClick={() => void downloadPreviewImage()}
                  disabled={isPreviewDownloading}
                  className="inline-flex h-8 items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Download size={13} aria-hidden="true" />
                  {isPreviewDownloading ? "Laddar..." : "Ladda ner"}
                </button>
                <button
                  type="button"
                  onClick={closeImagePreview}
                  aria-label="Stäng bildvisning"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5]"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="relative flex-1 overflow-auto bg-[#f0ece6] p-4">
              <div className="mx-auto flex min-h-full w-full items-center justify-center">
                <div
                  className="w-full touch-none select-none"
                  onTouchStart={handlePreviewTouchStart}
                  onTouchMove={handlePreviewTouchMove}
                  onTouchEnd={handlePreviewTouchEnd}
                  onTouchCancel={handlePreviewTouchEnd}
                  onWheel={handlePreviewWheel}
                >
                  <div
                    className="w-full transition-transform duration-150"
                    style={{ transform: `scale(${previewZoom})`, transformOrigin: "center center" }}
                  >
                    <ThumbnailImage
                      src={previewImage.full_url}
                      alt={imageDisplayName(previewImage.id)}
                      heightClassName="h-[45vh] sm:h-[calc(90vh-250px)]"
                      sizes="(max-width: 1024px) 95vw, 80vw"
                      priority
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end border-t border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
              <div className="group relative inline-flex">
                {isConverterSessionUnfinished ? (
                  <span
                    id="converter-blocked-reason"
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 w-max max-w-xs rounded-none border border-[#d8d2c8] bg-[#3d3a36] px-3 py-2 text-xs font-medium leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    Slutför den påbörjade konverteringen först
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => goToConverter(previewImage)}
                  disabled={isConverterSessionUnfinished}
                  aria-label="Konvertera"
                  aria-describedby={
                    isConverterSessionUnfinished ? "converter-blocked-reason" : undefined
                  }
                  className="rounded-none border border-[#d8d2c8] bg-white px-4 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Konvertera
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

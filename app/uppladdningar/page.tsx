"use client";

import { Download, Loader2, Minus, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, DragEvent, TouchEvent, WheelEvent, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { isAuthenticated } from "@/lib/auth";
import { formatDateTime } from "@/lib/format-date";
import {
  imageDisplayName,
  resolveImageDownloadFileName,
} from "@/lib/image-naming";
import { ThumbnailImage } from "@/components/ui/thumbnail-image";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader } from "@/components/layout/page";
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
  label: string | null;
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
    label: item.label ?? null,
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

    if (upload.full_url) {
      const payload: ConverterTransferPayload = {
        previewUrl: upload.full_url,
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
    if (!previewImage?.full_url) {
      return;
    }

    setIsPreviewDownloading(true);
    try {
      const response = await fetch(previewImage.full_url, { cache: "no-store" });
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

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    assignUploadFile(event.dataTransfer.files?.[0] ?? null);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    // Moving onto a card inside the drop area fires a leave on the area itself.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragActive(false);
  }

  return (
    <Page width="wide">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className="relative"
      >
        {isDragActive ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-3 z-20 flex items-center justify-center rounded-2xl border-[1.5px] border-dashed border-accent bg-white/85 backdrop-blur-sm"
          >
            <p className="text-sm font-medium text-stone-900">Släpp för att ladda upp</p>
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          id="image-file"
          type="file"
          accept="image/*"
          onChange={handleFileInputChange}
          disabled={isUploading}
          className="sr-only"
        />

        <PageHeader
          title="Uppladdningar"
          eyebrow={
            !isLoadingUploads && uploads.length > 0 ? (
              <span className="tabular-nums">
                {uploads.length} {uploads.length === 1 ? "originalbild" : "originalbilder"}
              </span>
            ) : null
          }
          description="Originalbilderna ni laddat upp. Öppna en bild och välj Konvertera för att rita om den. Du kan också dra in filer var som helst här."
          actions={
            <>
              {canDelete && isSelectionMode ? (
                <>
                  <button
                    type="button"
                    onClick={exitSelectionMode}
                    disabled={isDeletingSelected}
                    className={buttonClass("ghost")}
                  >
                    Avbryt
                  </button>
                  <button
                    type="button"
                    onClick={toggleSelectAllUploads}
                    disabled={isDeletingSelected || uploads.length === 0}
                    className={buttonClass("secondary")}
                  >
                    {selectedUploadIds.length === uploads.length && uploads.length > 0
                      ? "Avmarkera alla"
                      : "Markera alla"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSelectedUploads()}
                    disabled={isDeletingSelected || selectedUploadIds.length === 0}
                    className={buttonClass("danger")}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {isDeletingSelected
                      ? "Tar bort..."
                      : `Ta bort (${selectedUploadIds.length})`}
                  </button>
                </>
              ) : null}
              {canDelete && !isSelectionMode && uploads.length > 0 ? (
                <button type="button" onClick={enterSelectionMode} className={buttonClass("ghost")}>
                  Välj
                </button>
              ) : null}
              {!isSelectionMode ? (
                <label
                  htmlFor="image-file"
                  className={buttonClass(
                    "primary",
                    "md",
                    isUploading ? "pointer-events-none cursor-default opacity-70" : "cursor-pointer",
                  )}
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload size={15} aria-hidden="true" />
                  )}
                  {isUploading ? "Laddar upp..." : "Ladda upp"}
                </label>
              ) : null}
            </>
          }
        />

        {isRefreshingUploads ? (
          <p
            className="-mt-3 mb-4 inline-flex items-center gap-1.5 text-xs text-stone-500"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Uppdaterar...
          </p>
        ) : null}

        {isLoadingUploads ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5" aria-busy="true">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                <div className="aspect-square animate-pulse bg-stone-100" />
                <div className="space-y-2 px-3.5 py-3">
                  <div className="h-3.5 w-16 animate-pulse rounded bg-stone-100" />
                  <div className="h-3 w-24 animate-pulse rounded bg-stone-100" />
                </div>
              </div>
            ))}
            <span className="sr-only">Hämtar uppladdningar...</span>
          </div>
        ) : null}

        {!isLoadingUploads && !uploadsLoadFailed && uploads.length === 0 ? (
          <EmptyState
            title="Inga uppladdningar ännu"
            description="Dra in en bild på en gammal planritning hit, eller välj en fil. Sedan kan du konvertera den när du vill."
            action={
              <label htmlFor="image-file" className={buttonClass("primary", "md", "cursor-pointer")}>
                <Upload size={15} aria-hidden="true" />
                Ladda upp en bild
              </label>
            }
          />
        ) : null}

        {!isLoadingUploads && uploads.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {uploads.map((upload, uploadIndex) => {
              const isPreviewReady = !upload.preview_url || loadedPreviewIds[upload.id];
              const isMarked = selectedUploadIds.includes(upload.id);
              const isSelecting = isSelectionMode && canDelete;

              return (
                <article
                  key={upload.id}
                  className={`group flex flex-col overflow-hidden rounded-xl border bg-white transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(28,25,23,0.22)] ${
                    isMarked
                      ? "border-accent ring-2 ring-accent/20"
                      : "border-stone-200 shadow-[0_1px_2px_rgba(28,25,23,0.04)]"
                  }`}
                >
                  <div className="relative bg-stone-100/70 p-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (isSelecting) {
                          toggleUploadSelection(upload.id);
                          return;
                        }
                        openImagePreview(upload.id);
                      }}
                      disabled={!upload.preview_url}
                      aria-label={
                        isSelecting
                          ? `Markera ${imageDisplayName(upload.id)}`
                          : `Öppna ${imageDisplayName(upload.id)}`
                      }
                      className={`block w-full rounded-md disabled:cursor-default ${
                        isSelecting ? "cursor-pointer" : "cursor-zoom-in"
                      }`}
                    >
                      <ThumbnailImage
                        src={upload.preview_url}
                        alt={imageDisplayName(upload.id)}
                        onPrefetch={() => prefetchImage(upload.full_url)}
                        heightClassName="h-[180px]"
                        frameClassName="bg-white ring-1 ring-stone-200/80"
                        sizes={"(max-width: 768px) 45vw, (max-width: 1280px) 30vw, 20vw"}
                        priority={uploadIndex < 5}
                        onLoad={() =>
                          setLoadedPreviewIds((previous) => ({
                            ...previous,
                            [upload.id]: true,
                          }))
                        }
                      />
                    </button>
                    {isSelecting ? (
                      <label className="absolute right-4 top-4 inline-flex rounded-md bg-white/90 p-1 shadow-sm ring-1 ring-stone-200/70">
                        <input
                          type="checkbox"
                          checked={isMarked}
                          onChange={() => toggleUploadSelection(upload.id)}
                          disabled={isDeletingSelected}
                          aria-label={`Markera ${imageDisplayName(upload.id)}`}
                          className="h-4 w-4 rounded border-stone-300 accent-[var(--tenant-accent)]"
                        />
                      </label>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-stone-100 px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-stone-900">
                        {upload.label ?? imageDisplayName(upload.id)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-stone-500 tabular-nums">
                        {upload.label ? `${imageDisplayName(upload.id)} · ` : ""}
                        {formatDateTime(upload.created_at)}
                      </p>
                    </div>
                    {!isPreviewReady ? (
                      <Loader2
                        size={14}
                        className="shrink-0 animate-spin text-stone-400"
                        aria-label="Laddar förhandsvisning"
                      />
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>

      {previewImage?.preview_url ? (
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

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-stone-600">Bild {previewImage.id}</span>
                <button
                  type="button"
                  onClick={() => void downloadPreviewImage()}
                  disabled={isPreviewDownloading}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Download size={13} aria-hidden="true" />
                  {isPreviewDownloading ? "Laddar..." : "Ladda ner"}
                </button>
                <button
                  type="button"
                  onClick={closeImagePreview}
                  aria-label="Stäng bildvisning"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 transition hover:bg-stone-100"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="relative flex-1 overflow-auto bg-stone-100 p-4">
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

            <div className="flex items-center justify-end border-t border-stone-100 bg-stone-50 px-4 py-3">
              <div className="group relative inline-flex">
                {isConverterSessionUnfinished ? (
                  <span
                    id="converter-blocked-reason"
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 w-max max-w-xs rounded-lg border border-stone-200 bg-stone-900 px-3 py-2 text-xs font-medium leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
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
                  className={buttonClass("primary")}
                >
                  Konvertera
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}

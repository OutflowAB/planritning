"use client";

import Image from "next/image";
import { Download, Loader2, Minus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, DragEvent, TouchEvent, WheelEvent, useEffect, useRef, useState } from "react";

import { isAuthenticated } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/ui/toast-provider";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const UPLOADS_PREFIX = "uploads/";
const PREVIEW_CACHE_KEY = "upload-preview-cache-v1";
const PREVIEW_CACHE_TTL_MS = 55 * 60 * 1000;
const UPLOADS_LIST_CACHE_KEY = "uploads-list-cache-v1";
const UPLOADS_LIST_CACHE_TTL_MS = 15 * 60 * 1000;
const CONVERTER_TRANSFER_KEY = "converter-selected-upload-v1";
const GENERATION_EVENTS_EVENT = "generation_events";
const LEGACY_GENERATION_EVENT = "generation-updated";
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
  preview_url?: string | null;
};

type PreviewCacheEntry = {
  url: string;
  expiresAt: number;
};

type UploadsListCachePayload = {
  rows: UploadedImageRow[];
  expiresAt: number;
};

type ConverterTransferPayload = {
  previewUrl: string;
  fileName: string;
  uploadId: number;
};

function readPreviewCache() {
  if (typeof window === "undefined") {
    return new Map<string, PreviewCacheEntry>();
  }

  const rawCache = window.localStorage.getItem(PREVIEW_CACHE_KEY);
  if (!rawCache) {
    return new Map<string, PreviewCacheEntry>();
  }

  try {
    const parsed = JSON.parse(rawCache) as Record<string, PreviewCacheEntry>;
    const now = Date.now();
    const map = new Map<string, PreviewCacheEntry>();

    Object.entries(parsed).forEach(([path, entry]) => {
      if (entry?.url && typeof entry.expiresAt === "number" && entry.expiresAt > now) {
        map.set(path, entry);
      }
    });

    return map;
  } catch {
    return new Map<string, PreviewCacheEntry>();
  }
}

function writePreviewCache(entries: Map<string, PreviewCacheEntry>) {
  if (typeof window === "undefined") {
    return;
  }

  const serialized: Record<string, PreviewCacheEntry> = {};
  entries.forEach((entry, path) => {
    serialized[path] = entry;
  });

  window.localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(serialized));
}

function readUploadsListCache() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawCache = window.sessionStorage.getItem(UPLOADS_LIST_CACHE_KEY);
  if (!rawCache) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawCache) as UploadsListCachePayload;
    if (
      !Array.isArray(parsed?.rows) ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      window.sessionStorage.removeItem(UPLOADS_LIST_CACHE_KEY);
      return null;
    }

    return parsed.rows as UploadedImageRow[];
  } catch {
    window.sessionStorage.removeItem(UPLOADS_LIST_CACHE_KEY);
    return null;
  }
}

function writeUploadsListCache(rows: UploadedImageRow[]) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: UploadsListCachePayload = {
    rows,
    expiresAt: Date.now() + UPLOADS_LIST_CACHE_TTL_MS,
  };
  window.sessionStorage.setItem(UPLOADS_LIST_CACHE_KEY, JSON.stringify(payload));
}

export default function UppladdningarPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const canDelete = isAuthenticated();
  const converterPath = pathname.startsWith("/admin") ? "/admin/dashboard" : "/startsida";
  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isLoadingUploads, setIsLoadingUploads] = useState(true);
  const [uploadsLoadFailed, setUploadsLoadFailed] = useState(false);
  const [uploads, setUploads] = useState<UploadedImageRow[]>([]);
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
    if (upload.preview_url) {
      const payload: ConverterTransferPayload = {
        previewUrl: upload.preview_url,
        fileName: upload.file_name,
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
      link.download = previewImage.file_name || "planritning";
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
      const response = await fetch("/api/delete-uploads", {
        method: "POST",
        credentials: "include",
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
        await loadUploads(true);
        window.dispatchEvent(new CustomEvent("library-updated"));
        window.dispatchEvent(new Event(GENERATION_EVENTS_EVENT));
        window.dispatchEvent(new Event(LEGACY_GENERATION_EVENT));
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

  async function loadUploads(forceRefresh = false) {
    setUploadsLoadFailed(false);
    if (!forceRefresh) {
      const cachedRows = readUploadsListCache();
      if (cachedRows) {
        setUploads(cachedRows);
        setIsLoadingUploads(false);
        return;
      }
    }

    setIsLoadingUploads(true);

    const { data, error: queryError } = await supabase
      .from(UPLOADS_TABLE)
      .select("id, file_name, file_path, file_size, mime_type, created_at")
      .like("file_path", `${UPLOADS_PREFIX}%`)
      .order("created_at", { ascending: false });

    if (queryError) {
      setUploadsLoadFailed(true);
      showToast(`Kunde inte hämta uppladdningar: ${queryError.message}`, "error");
      setIsLoadingUploads(false);
      return;
    }

    const rows = (data as UploadedImageRow[]) ?? [];
    const imagePaths = rows
      .filter((row) => row.mime_type?.startsWith("image/"))
      .map((row) => row.file_path);

    const previewByPath = new Map<string, string>();
    const previewCache = readPreviewCache();
    const pathsToSign: string[] = [];

    imagePaths.forEach((path) => {
      const cached = previewCache.get(path);
      if (cached) {
        previewByPath.set(path, cached.url);
      } else {
        pathsToSign.push(path);
      }
    });

    if (pathsToSign.length > 0) {
      const { data: signedData } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrls(pathsToSign, 3600);

      signedData?.forEach((item, index) => {
        if (item?.signedUrl) {
          const path = pathsToSign[index];
          const expiresAt = Date.now() + PREVIEW_CACHE_TTL_MS;

          previewByPath.set(path, item.signedUrl);
          previewCache.set(path, {
            url: item.signedUrl,
            expiresAt,
          });
        }
      });
    }

    // Keep cache tidy and relevant for current upload set.
    const validPaths = new Set(imagePaths);
    Array.from(previewCache.keys()).forEach((path) => {
      const entry = previewCache.get(path);
      if (!validPaths.has(path) || !entry || entry.expiresAt <= Date.now()) {
        previewCache.delete(path);
      }
    });
    writePreviewCache(previewCache);

    const rowsWithPreview = rows.map((row) => ({
      ...row,
      preview_url: previewByPath.get(row.file_path) ?? null,
    }));

    setUploads(rowsWithPreview);
    setSelectedUploadIds((previous) =>
      previous.filter((id) => rowsWithPreview.some((row) => row.id === id)),
    );
    writeUploadsListCache(rowsWithPreview);
    setIsLoadingUploads(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUploads();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!previewImage) {
      return;
    }
    setPreviewZoom(1);

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeImagePreview();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [previewImage]);

  useEffect(() => {
    setLoadedPreviewIds((previous) => {
      const next: Record<number, boolean> = {};
      uploads.forEach((upload) => {
        const alreadyLoaded = previous[upload.id] ?? false;
        // Keep "loaded" sticky for current list, but only for images with previews.
        next[upload.id] = upload.preview_url ? alreadyLoaded : true;
      });
      return next;
    });
  }, [uploads]);

  async function uploadFile(file: File) {
    if (isUploading) {
      return;
    }

    setIsUploading(true);

    try {
      const extension = file.name.split(".").pop() ?? "jpg";
      const uniqueName = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const storagePath = `uploads/${uniqueName}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, file, {
          upsert: false,
          contentType: file.type,
        });

      if (uploadError) {
        showToast(`Uppladdning misslyckades: ${uploadError.message}`, "error");
        return;
      }

      const { error: insertError } = await supabase.from(UPLOADS_TABLE).insert({
        file_name: file.name,
        file_path: storagePath,
        file_size: file.size,
        mime_type: file.type || null,
      });

      if (insertError) {
        await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
        showToast(`Kunde inte spara i databasen: ${insertError.message}`, "error");
        return;
      }

      showToast("Bilden laddades upp och sparades i databasen.");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await loadUploads(true);
    } catch {
      showToast("Ett oväntat fel uppstod under uppladdning.", "error");
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
    <section className="relative flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="flex w-full max-w-4xl flex-col gap-6">
        <div className="rounded-none border border-[#d8d2c8] bg-white p-6 shadow-sm">
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

        <div className="rounded-none border border-[#d8d2c8] bg-white p-6 shadow-sm">
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

            {!isLoadingUploads && !uploadsLoadFailed && uploads.length === 0 ? (
              <p className="mt-3 text-sm text-[#6a6258]">Inga uppladdningar finns ännu.</p>
            ) : null}

            {!isLoadingUploads && uploads.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {uploads.map((upload) => {
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
                    {upload.preview_url ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (isSelectionMode && canDelete) {
                            toggleUploadSelection(upload.id);
                            return;
                          }
                          openImagePreview(upload.id);
                        }}
                        className={isSelectionMode && canDelete ? "cursor-pointer" : "cursor-zoom-in"}
                      >
                        <Image
                          src={upload.preview_url}
                          alt={upload.file_name}
                          width={1200}
                          height={900}
                          onLoad={() =>
                            setLoadedPreviewIds((previous) => ({
                              ...previous,
                              [upload.id]: true,
                            }))
                          }
                          className="max-h-[220px] w-auto max-w-full rounded-none border border-[#d8d2c8] bg-white object-contain"
                        />
                      </button>
                    ) : (
                      <div className="flex h-52 w-full items-center justify-center rounded-none border border-[#d8d2c8] bg-[#f7f4ef] text-sm text-[#7b746a]">
                        Ingen bildförhandsvisning
                      </div>
                    )}
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
                  className="touch-none select-none"
                  onTouchStart={handlePreviewTouchStart}
                  onTouchMove={handlePreviewTouchMove}
                  onTouchEnd={handlePreviewTouchEnd}
                  onTouchCancel={handlePreviewTouchEnd}
                  onWheel={handlePreviewWheel}
                >
                  <Image
                    src={previewImage.preview_url}
                    alt={previewImage.file_name}
                    width={2200}
                    height={1600}
                    className="h-auto max-h-[calc(90vh-250px)] w-auto max-w-full border border-[#d8d2c8] bg-white object-contain transition-transform duration-150"
                    style={{ transform: `scale(${previewZoom})`, transformOrigin: "center center" }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end border-t border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
              <button
                type="button"
                onClick={() => goToConverter(previewImage)}
                aria-label="Konvertera"
                title="Konvertera"
                className="rounded-none border border-[#d8d2c8] bg-white px-4 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
              >
                Konvertera
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

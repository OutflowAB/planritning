"use client";

import Image from "next/image";
import { ChevronDown, Download, Loader2, Minus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TouchEvent, WheelEvent, useEffect, useRef, useState } from "react";

import { getStoredRole } from "@/lib/auth";
import {
  exportLibraryFloorplan,
  type LibraryExportFormat,
} from "@/lib/floorplan/export-library";
import { supabase } from "@/lib/supabase";
import { buildVerktygHref, setPendingVerktygSave } from "@/lib/verktyg-save-session";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const GENERATED_PREFIX = "generated/";
const PREVIEW_CACHE_KEY = "library-preview-cache-v1";
const PREVIEW_CACHE_TTL_MS = 55 * 60 * 1000;
const LIBRARY_LIST_CACHE_KEY = "library-list-cache-v1";
const LIBRARY_LIST_CACHE_TTL_MS = 15 * 60 * 1000;
const GENERATION_EVENTS_EVENT = "generation_events";
const LEGACY_GENERATION_EVENT = "generation-updated";
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.5;
const DOWNLOAD_FORMATS: Array<{ format: LibraryExportFormat; label: string }> = [
  { format: "svg", label: "SVG" },
  { format: "pdf", label: "PDF" },
  { format: "jpg", label: "JPG" },
  { format: "jpeg", label: "JPEG" },
];

type GeneratedImageRow = {
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

type LibraryListCachePayload = {
  rows: GeneratedImageRow[];
  expiresAt: number;
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

function readLibraryListCache() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawCache = window.sessionStorage.getItem(LIBRARY_LIST_CACHE_KEY);
  if (!rawCache) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawCache) as LibraryListCachePayload;
    if (
      !Array.isArray(parsed?.rows) ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      window.sessionStorage.removeItem(LIBRARY_LIST_CACHE_KEY);
      return null;
    }

    return parsed.rows as GeneratedImageRow[];
  } catch {
    window.sessionStorage.removeItem(LIBRARY_LIST_CACHE_KEY);
    return null;
  }
}

function writeLibraryListCache(rows: GeneratedImageRow[]) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: LibraryListCachePayload = {
    rows,
    expiresAt: Date.now() + LIBRARY_LIST_CACHE_TTL_MS,
  };
  window.sessionStorage.setItem(LIBRARY_LIST_CACHE_KEY, JSON.stringify(payload));
}

export default function BibliotekPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canDelete = pathname.startsWith("/admin") || getStoredRole() === "admin";
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [images, setImages] = useState<GeneratedImageRow[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<number[]>([]);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isPreviewDownloading, setIsPreviewDownloading] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<LibraryExportFormat | null>(null);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [isSendingToVerktyg, setIsSendingToVerktyg] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const selectedImageId = searchParams.get("imageId");
  const selectedImagePath = searchParams.get("imagePath");
  const previewImageId = searchParams.get("previewImageId");
  const previewImagePath = searchParams.get("previewImagePath");
  const selectedImage = images.find(
    (image) =>
      (selectedImageId && String(image.id) === selectedImageId) ||
      (selectedImagePath && image.file_path === selectedImagePath),
  );
  const previewImage = images.find(
    (image) =>
      (previewImageId && String(image.id) === previewImageId) ||
      (previewImagePath && image.file_path === previewImagePath),
  );

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

  function setQueryParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([paramName, value]) => {
      if (value) {
        params.set(paramName, value);
      } else {
        params.delete(paramName);
      }
    });

    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function openImagePreview(imageId: number) {
    const selected = images.find((image) => image.id === imageId);
    setPreviewZoom(1);
    setQueryParams({
      previewImageId: String(imageId),
      previewImagePath: selected?.file_path,
    });
  }

  function closeImagePreview() {
    setPreviewZoom(1);
    setShowDownloadMenu(false);
    setQueryParams({
      previewImageId: undefined,
      previewImagePath: undefined,
    });
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

  async function downloadPreviewImage(format: LibraryExportFormat) {
    if (!previewImage) {
      return;
    }

    setIsPreviewDownloading(true);
    setDownloadingFormat(format);
    setLoadError("");

    try {
      await exportLibraryFloorplan({
        imageId: previewImage.id,
        imagePath: previewImage.file_path,
        fileName: previewImage.file_name,
        format,
        fallbackUrl: previewImage.preview_url,
      });
      setShowDownloadMenu(false);
    } catch {
      setLoadError("Kunde inte ladda ner bilden just nu.");
    } finally {
      setIsPreviewDownloading(false);
      setDownloadingFormat(null);
    }
  }

  async function sendBackToVerktyg() {
    if (!previewImage || isSendingToVerktyg) {
      return;
    }

    setIsSendingToVerktyg(true);
    setLoadError("");

    try {
      const response = await fetch("/api/unsave-generation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageId: previewImage.id,
          filePath: previewImage.file_path,
        }),
      });
      const data = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(data.message ?? "Kunde inte skicka tillbaka till verktyg.");
      }

      setPendingVerktygSave({
        imageId: previewImage.id,
        imagePath: previewImage.file_path,
      });
      window.dispatchEvent(new Event("library-updated"));
      router.push(
        buildVerktygHref(pathname, {
          imageId: previewImage.id,
          imagePath: previewImage.file_path,
        }),
      );
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Kunde inte skicka tillbaka till verktyg.",
      );
      setIsSendingToVerktyg(false);
    }
  }

  function toggleImageSelection(imageId: number) {
    setSelectedImageIds((previous) =>
      previous.includes(imageId)
        ? previous.filter((id) => id !== imageId)
        : [...previous, imageId],
    );
  }

  function toggleSelectAllImages() {
    setSelectedImageIds((previous) =>
      previous.length === images.length ? [] : images.map((image) => image.id),
    );
  }

  async function handleDeleteSelectedImages() {
    if (!canDelete || isDeletingSelected || selectedImageIds.length === 0) {
      return;
    }

    setLoadError("");
    setActionSuccess("");
    setIsDeletingSelected(true);

    const selectedImages = images.filter((image) => selectedImageIds.includes(image.id));
    const deletedIds: number[] = [];
    let failedCount = 0;
    let lastErrorMessage = "";

    try {
      for (const image of selectedImages) {
        const response = await fetch("/api/admin/delete-image", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: image.id,
            filePath: image.file_path,
          }),
        });
        const data = (await response.json()) as { message?: string };

        if (!response.ok) {
          failedCount += 1;
          lastErrorMessage = data.message ?? "Kunde inte ta bort bilden.";
          continue;
        }

        deletedIds.push(image.id);

        if (previewImage?.id === image.id) {
          closeImagePreview();
        }
      }

      if (deletedIds.length > 0) {
        setImages((previous) => previous.filter((entry) => !deletedIds.includes(entry.id)));
        setSelectedImageIds((previous) => previous.filter((id) => !deletedIds.includes(id)));
        setActionSuccess(
          deletedIds.length === 1
            ? "1 bild raderades."
            : `${deletedIds.length} bilder raderades.`,
        );
        await loadLibrary(true);
        window.dispatchEvent(new CustomEvent("library-updated"));
        window.dispatchEvent(new Event(GENERATION_EVENTS_EVENT));
        window.dispatchEvent(new Event(LEGACY_GENERATION_EVENT));
      }

      if (failedCount > 0) {
        setLoadError(
          failedCount === 1
            ? lastErrorMessage || "Kunde inte ta bort en markerad bild."
            : `Kunde inte ta bort ${failedCount} markerade bilder.`,
        );
      }
    } finally {
      setIsDeletingSelected(false);
    }
  }

  async function loadLibrary(forceRefresh = false) {
    setLoadError("");
    if (!forceRefresh) {
      const cachedRows = readLibraryListCache();
      if (cachedRows) {
        setImages(cachedRows);
        setIsLoading(false);
        return;
      }
    }

    setIsLoading(true);

    const { data, error: queryError } = await supabase
      .from(UPLOADS_TABLE)
      .select("id, file_name, file_path, file_size, mime_type, created_at, saved_at")
      .like("file_path", `${GENERATED_PREFIX}%`)
      .not("saved_at", "is", null)
      .order("created_at", { ascending: false });

    if (queryError) {
      setLoadError(`Kunde inte hämta biblioteket: ${queryError.message}`);
      setIsLoading(false);
      return;
    }

    const rows = (data as GeneratedImageRow[]) ?? [];
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

    setImages(rowsWithPreview);
    setSelectedImageIds((previous) =>
      previous.filter((id) => rowsWithPreview.some((row) => row.id === id)),
    );
    writeLibraryListCache(rowsWithPreview);
    setIsLoading(false);
  }

  useEffect(() => {
    const shouldForceRefresh =
      Boolean(previewImageId) ||
      Boolean(previewImagePath) ||
      Boolean(selectedImageId) ||
      Boolean(selectedImagePath);

    const timer = window.setTimeout(() => {
      void loadLibrary(shouldForceRefresh);
    }, 0);

    function handleLibraryUpdated() {
      void loadLibrary(true);
    }

    window.addEventListener("library-updated", handleLibraryUpdated);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("library-updated", handleLibraryUpdated);
    };
  }, [previewImageId, previewImagePath, selectedImageId, selectedImagePath]);

  useEffect(() => {
    if (!selectedImage || images.length === 0) {
      return;
    }

    const targetElement = document.getElementById(`library-image-${selectedImage.id}`);
    if (!targetElement) {
      return;
    }

    targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [images, selectedImage]);

  useEffect(() => {
    if (!previewImage) {
      return;
    }
    setPreviewZoom(1);
    setShowDownloadMenu(false);
  }, [previewImage]);

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setShowDownloadMenu((isOpen) => {
        if (isOpen) {
          return false;
        }

        closeImagePreview();
        return false;
      });
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [previewImage]);

  useEffect(() => {
    if (!showDownloadMenu) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!downloadMenuRef.current?.contains(event.target as Node)) {
        setShowDownloadMenu(false);
      }
    }

    document.addEventListener("click", handlePointerDown);
    return () => document.removeEventListener("click", handlePointerDown);
  }, [showDownloadMenu]);

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="w-full rounded-none border border-[#d8d2c8] bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-[#3d3a36]">Planritningar</h1>
          {canDelete ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAllImages}
                disabled={isDeletingSelected || images.length === 0}
                className="rounded-none border border-[#d8d2c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {selectedImageIds.length === images.length && images.length > 0
                  ? "Avmarkera alla"
                  : "Markera alla"}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteSelectedImages()}
                disabled={isDeletingSelected || selectedImageIds.length === 0}
                className="inline-flex items-center gap-1 rounded-none border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 size={12} aria-hidden="true" />
                {isDeletingSelected
                  ? "Tar bort..."
                  : `Ta bort markerade (${selectedImageIds.length})`}
              </button>
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-none border border-[#d8d2c8] bg-[#f7f4ef] px-4 py-6 text-[#6a6258]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <p className="text-sm font-medium">Hämtar genererade bilder...</p>
          </div>
        ) : null}

        {loadError ? (
          <p className="mt-6 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        ) : null}
        {actionSuccess ? (
          <p className="mt-6 rounded-none border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {actionSuccess}
          </p>
        ) : null}

        {!isLoading && !loadError && images.length === 0 ? (
          <p className="mt-6 text-sm text-[#6a6258]">
            Inga genererade bilder finns ännu.
          </p>
        ) : null}

        {!isLoading && !loadError && images.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {images.map((image) => {
              const isMarked = selectedImageIds.includes(image.id);

              return (
              <article
                key={image.id}
                id={`library-image-${image.id}`}
                className={`overflow-hidden rounded-none border bg-white ${
                  selectedImage?.id === image.id || isMarked
                    ? "border-[#8b7355] shadow-[0_0_0_2px_rgba(139,115,85,0.2)]"
                    : "border-[#d8d2c8]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
                  <p className="text-xs font-medium text-[#7b746a]">
                    {new Date(image.created_at).toLocaleString("sv-SE")}
                  </p>
                  <div className="ml-auto flex items-center gap-2">
                    <p className="text-xs font-semibold text-[#6a6258]">Bild {image.id}</p>
                    {canDelete ? (
                      <label className="inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={isMarked}
                          onChange={() => toggleImageSelection(image.id)}
                          disabled={isDeletingSelected}
                          className="h-5 w-5 rounded border-[#b7aea1] text-[#8b7355] focus:ring-[#8b7355]"
                        />
                      </label>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center justify-center bg-[#f0ece6] p-4">
                  {image.preview_url ? (
                    <button
                      type="button"
                      onClick={() => openImagePreview(image.id)}
                      className="cursor-zoom-in"
                    >
                      <Image
                        src={image.preview_url}
                        alt={image.file_name}
                        width={1200}
                        height={900}
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

      {previewImage?.preview_url ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={closeImagePreview}
          role="presentation"
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl flex-col rounded-none border border-[#d8d2c8] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
              <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-[#6a6258]">
                Bild {previewImage.id}
              </div>
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
                {previewZoom !== 1 ? (
                  <button
                    type="button"
                    onClick={resetPreviewZoom}
                    aria-label="Återställ zoom"
                    className="inline-flex h-8 items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    Reset
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <div className="relative inline-block" ref={downloadMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowDownloadMenu((previous) => !previous)}
                    disabled={isPreviewDownloading}
                    aria-expanded={showDownloadMenu}
                    aria-haspopup="menu"
                    className="inline-flex h-8 items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Download size={13} aria-hidden="true" />
                    {isPreviewDownloading ? "Laddar..." : "Ladda ner"}
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>

                  {showDownloadMenu ? (
                    <div
                      role="menu"
                      aria-label="Välj filformat"
                      className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-none border border-[#d8d2c8] bg-white"
                    >
                      {DOWNLOAD_FORMATS.map(({ format, label }, index) => (
                        <button
                          key={format}
                          type="button"
                          role="menuitem"
                          disabled={isPreviewDownloading}
                          onClick={() => void downloadPreviewImage(format)}
                          className={`flex h-8 w-full items-center justify-between px-2 text-left text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60 ${
                            index < DOWNLOAD_FORMATS.length - 1 ? "border-b border-[#d8d2c8]" : ""
                          }`}
                        >
                          <span>{label}</span>
                          {downloadingFormat === format ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
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
                    src={previewImage.preview_url}
                    alt={previewImage.file_name}
                    width={2200}
                    height={1600}
                    className="h-auto max-h-[calc(90vh-190px)] w-auto max-w-full border border-[#d8d2c8] bg-white object-contain transition-transform duration-150"
                    style={{ transform: `scale(${previewZoom})`, transformOrigin: "center center" }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center border-t border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
              <button
                type="button"
                onClick={() => void sendBackToVerktyg()}
                disabled={isSendingToVerktyg}
                className="inline-flex h-8 items-center rounded-none border border-[#d8d2c8] bg-white px-3 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSendingToVerktyg ? "Skickar..." : "Skicka till verktyg igen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

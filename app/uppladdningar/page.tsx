"use client";

import Image from "next/image";
import { Download, Loader2, Minus, Plus, RotateCcw, Upload, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, TouchEvent, WheelEvent, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const UPLOADS_PREFIX = "uploads/";
const PREVIEW_CACHE_KEY = "upload-preview-cache-v1";
const PREVIEW_CACHE_TTL_MS = 55 * 60 * 1000;
const UPLOADS_LIST_CACHE_KEY = "uploads-list-cache-v1";
const UPLOADS_LIST_CACHE_TTL_MS = 15 * 60 * 1000;
const CONVERTER_TRANSFER_KEY = "converter-selected-upload-v1";
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.5;

type UploadResult = {
  fileName: string;
  path: string;
  uploadedAt: string;
};

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingUploads, setIsLoadingUploads] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [success, setSuccess] = useState("");
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null);
  const [uploads, setUploads] = useState<UploadedImageRow[]>([]);
  const [loadedPreviewIds, setLoadedPreviewIds] = useState<Record<number, boolean>>({});
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isPreviewDownloading, setIsPreviewDownloading] = useState(false);
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
      };
      window.sessionStorage.setItem(CONVERTER_TRANSFER_KEY, JSON.stringify(payload));
    }

    router.push("/startsida");
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
      setLoadError("Kunde inte ladda ner bilden just nu.");
    } finally {
      setIsPreviewDownloading(false);
    }
  }

  async function loadUploads(forceRefresh = false) {
    setLoadError("");
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
      setLoadError(`Kunde inte hämta uppladdningar: ${queryError.message}`);
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

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!selectedFile) {
      setError("Välj en bildfil först.");
      return;
    }

    setIsUploading(true);

    try {
      const extension = selectedFile.name.split(".").pop() ?? "jpg";
      const uniqueName = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const storagePath = `uploads/${uniqueName}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, selectedFile, {
          upsert: false,
          contentType: selectedFile.type,
        });

      if (uploadError) {
        setError(`Uppladdning misslyckades: ${uploadError.message}`);
        return;
      }

      const { error: insertError } = await supabase.from(UPLOADS_TABLE).insert({
        file_name: selectedFile.name,
        file_path: storagePath,
        file_size: selectedFile.size,
        mime_type: selectedFile.type || null,
      });

      if (insertError) {
        // Keep storage and DB metadata in sync if insert fails.
        await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
        setError(`Kunde inte spara i databasen: ${insertError.message}`);
        return;
      }

      const uploadInfo: UploadResult = {
        fileName: selectedFile.name,
        path: storagePath,
        uploadedAt: new Date().toLocaleString("sv-SE"),
      };

      setLastUpload(uploadInfo);
      setSelectedFile(null);
      setSuccess("Bilden laddades upp och sparades i databasen.");
      setIsUploaderOpen(false);
      await loadUploads(true);
    } catch {
      setError("Ett oväntat fel uppstod under uppladdning.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="relative flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="w-full rounded-none border border-[#d8d2c8] bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#3d3a36]">Uppladdningar</h1>
          </div>
          <button
            type="button"
            onClick={() => setIsUploaderOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-none border border-[#d8d2c8] bg-[#f7f4ef] px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#eee8df]"
          >
            <Upload size={14} aria-hidden="true" />
            Ladda upp
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="mt-4 rounded-none border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
          </p>
        ) : null}

        {lastUpload ? (
          <div className="mt-6 rounded-none border border-[#d8d2c8] bg-[#f7f4ef] p-4">
            <h2 className="text-sm font-semibold text-[#4d463f]">
              Senaste uppladdning
            </h2>
            <p className="mt-2 text-sm text-[#6a6258]">
              Fil: <span className="font-medium text-[#3d3a36]">{lastUpload.fileName}</span>
            </p>
            <p className="mt-1 text-sm text-[#6a6258]">
              Sökväg: <span className="font-medium text-[#3d3a36]">{lastUpload.path}</span>
            </p>
            <p className="mt-1 text-sm text-[#6a6258]">
              Tid: <span className="font-medium text-[#3d3a36]">{lastUpload.uploadedAt}</span>
            </p>
          </div>
        ) : null}

        <div className="mt-8">
          {isLoadingUploads ? (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-none border border-[#d8d2c8] bg-[#f7f4ef] px-4 py-6 text-[#6a6258]">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <p className="text-sm font-medium">Hämtar uppladdningar...</p>
            </div>
          ) : null}

          {loadError ? (
            <p className="mt-3 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {loadError}
            </p>
          ) : null}

          {!isLoadingUploads && !loadError && uploads.length === 0 ? (
            <p className="mt-3 text-sm text-[#6a6258]">
              Inga uppladdningar finns ännu.
            </p>
          ) : null}

          {!isLoadingUploads && !loadError && uploads.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              {uploads.map((upload) => {
                const isPreviewReady = !upload.preview_url || loadedPreviewIds[upload.id];

                return (
                <article
                  key={upload.id}
                  className="overflow-hidden rounded-none border border-[#d8d2c8] bg-white"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
                    <p className="shrink-0 text-xs font-medium text-[#7b746a]">
                      {new Date(upload.created_at).toLocaleString("sv-SE")}
                    </p>
                    {isPreviewReady ? (
                      <button
                        type="button"
                        onClick={() => goToConverter(upload)}
                        aria-label="Konvertera"
                        title="Konvertera"
                        className="rounded-none border border-[#d8d2c8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
                      >
                        Konvertera
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#7b746a]">
                        <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                        Laddar...
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-center bg-[#f0ece6] p-4">
                    {upload.preview_url ? (
                      <button
                        type="button"
                        onClick={() => openImagePreview(upload.id)}
                        className="cursor-zoom-in"
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

      {isUploaderOpen ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-4 py-6"
          onClick={() => setIsUploaderOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-lg rounded-none border border-[#d8d2c8] bg-white p-4 shadow-[0_12px_40px_rgba(0,0,0,0.22)]"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#3d3a36]">Ladda upp bild</h2>
              <button
                type="button"
                onClick={() => setIsUploaderOpen(false)}
                aria-label="Stäng uppladdning"
                className="inline-flex h-9 w-9 items-center justify-center rounded-none border border-[#d8d2c8] bg-[#f7f4ef] text-[#4d463f] transition hover:bg-[#eee8df]"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form
              onSubmit={handleUpload}
              className="rounded-none bg-white"
            >
              <label
                htmlFor="image-file"
                className="flex min-h-[230px] cursor-pointer flex-col items-center justify-center rounded-none border-2 border-dashed border-[#d8d2c8] bg-[#faf8f4] px-6 py-8 text-center"
              >
                <p className="text-base font-medium text-[#6a6258]">
                  Dra och släpp din planritning här
                </p>
                <p className="mt-2 text-base text-[#6a6258]">
                  eller{" "}
                  <span className="font-semibold underline decoration-[#4d463f] underline-offset-4">
                    bläddra bland filer
                  </span>
                </p>
                {selectedFile ? (
                  <p className="mt-4 max-w-full truncate text-sm font-medium text-[#5c544a]">
                    Vald fil: {selectedFile.name}
                  </p>
                ) : null}
              </label>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setError("");
                  }}
                  className="rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f7f4ef]"
                >
                  Rensa
                </button>
                <button
                  type="submit"
                  disabled={isUploading || !selectedFile}
                  className="ml-auto rounded-none bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading ? "Laddar upp..." : "Ladda upp"}
                </button>
              </div>
              <input
                id="image-file"
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setSelectedFile(event.target.files?.[0] ?? null)
                }
                className="sr-only"
              />
            </form>
          </div>
        </div>
      ) : null}

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
          </div>
        </div>
      ) : null}
    </section>
  );
}

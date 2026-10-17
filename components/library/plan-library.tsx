"use client";

import {
  ChevronDown,
  Download,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TouchEvent, WheelEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  exportLibraryFloorplan,
  type LibraryExportFormat,
} from "@/lib/floorplan/export-library";
import { LIBRARY_EXPORT_FORMATS } from "@/lib/floorplan/export-layout";
import { ThumbnailImage } from "@/components/ui/thumbnail-image";
import { planDisplayName, planDownloadBaseName } from "@/lib/image-naming";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { apiFetch, apiJson, describeError } from "@/lib/api-client";
import { imageUrl } from "@/lib/image-url";
import { prefetchImage } from "@/lib/prefetch-image";
import { dispatchGenerationUpdated, dispatchLibraryUpdated, LIBRARY_UPDATED_EVENT, subscribeToAppEvent } from "@/lib/app-events";
import { useCachedList } from "@/lib/use-cached-list";
import type { ImageListItem } from "@/app/api/images/route";
import { buildVerktygHref, setPendingVerktygSave } from "@/lib/verktyg-save-session";

/**
 * One list of plans, shown three ways:
 * - finished: every finished plan and every approved AI conversion (Planritningar);
 * - scans: scanned and blank plans not yet finished, with the buttons that start them (Skannare);
 */
export type LibraryMode = "finished" | "scans";

const MODES: Record<
  LibraryMode,
  { title: string; query: Record<string, string>; cacheKey: string; empty: string; intro?: string }
> = {
  finished: {
    title: "Planritningar",
    query: { scope: "plans" },
    cacheKey: "library-plans-v1",
    empty: "Inga planritningar ännu. Godkända konverteringar och slutförda planer hamnar här.",
    intro: "Redigera en plan och tryck Slutför för att kunna ladda ner den.",
  },
  scans: {
    title: "Skannare",
    query: { published: "0", source: "blank" },
    cacheKey: "library-scans-v1",
    empty: "Inga påbörjade skanningar.",
    intro: "Importera en LiDAR-skanning eller börja från en tom planritning. Färdiga planer finns under Planritningar.",
  },
};
const PAGE_SIZE = 60;
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.5;
const DOWNLOAD_FORMATS = LIBRARY_EXPORT_FORMATS;

type GeneratedImageRow = {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string | null;
  created_at: string;
  version: string | null;
  preview_url: string | null;
  full_url: string | null;
  address: string | null;
  floor_label: string | null;
  published_at: string | null;
  can_edit: boolean;
};

function withImageUrls(item: ImageListItem): GeneratedImageRow {
  const isImage = item.mime_type?.startsWith("image/") ?? false;
  return {
    id: item.id,
    file_name: item.file_name,
    file_path: item.file_path,
    file_size: item.file_size,
    mime_type: item.mime_type,
    created_at: item.created_at,
    version: item.version,
    address: item.address,
    floor_label: item.floor_label,
    published_at: item.published_at,
    can_edit: item.can_edit,
    preview_url: isImage ? imageUrl(item.id, "thumb", item.version) : null,
    full_url: isImage ? imageUrl(item.id, "full", item.version) : null,
  };
}

async function fetchLibraryPage(mode: LibraryMode, signal: AbortSignal | undefined, offset: number, search = "") {
  const params = new URLSearchParams({
    kind: "generated",
    saved: "1",
    limit: String(PAGE_SIZE),
    offset: String(offset),
    ...MODES[mode].query,
  });
  if (search) params.set("q", search);
  const { items } = await apiJson<{ items: ImageListItem[] }>(`/api/images?${params.toString()}`, { signal });
  return items.map(withImageUrls);
}

export function PlanLibrary({ mode }: { mode: LibraryMode }) {
  const config = MODES[mode];
  const { confirm, dialog: confirmDialog } = useConfirm();
  const embedded = false;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    items: images,
    setItems: setImages,
    isLoading,
    isRefreshing,
    error: loadError,
    reload: reloadLibrary,
  } = useCachedList<GeneratedImageRow>(
    config.cacheKey,
    (signal) => fetchLibraryPage(mode, signal, 0),
    "Kunde inte hämta planritningarna.",
  );
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [selectedImageIds, setSelectedImageIds] = useState<number[]>([]);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isPreviewDownloading, setIsPreviewDownloading] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<LibraryExportFormat | null>(null);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [isSendingToVerktyg, setIsSendingToVerktyg] = useState(false);
  const [isCreatingBlank, setIsCreatingBlank] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<GeneratedImageRow[] | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const shownImages = searchResults ?? images;
  // Which card triggered the edit, so only that button shows a spinner.
  const [editingImageId, setEditingImageId] = useState<number | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
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
    setActionError("");

    try {
      await exportLibraryFloorplan({
        imageId: previewImage.id,
        imagePath: previewImage.file_path,
        fileName: planDownloadBaseName(previewImage),
        format,
        houseText: { address: previewImage.address, floorLabel: previewImage.floor_label },
        fallbackUrl: previewImage.full_url,
      });
      setShowDownloadMenu(false);
    } catch {
      setActionError("Kunde inte ladda ner bilden just nu.");
    } finally {
      setIsPreviewDownloading(false);
      setDownloadingFormat(null);
    }
  }

  // Searching asks the server, so plans beyond the first page are found too.
  useEffect(() => {
    const term = search.trim();
    if (!term) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchLibraryPage(mode, controller.signal, 0, term)
        .then(setSearchResults)
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setActionError(describeError(error, "Sökningen misslyckades.") ?? "");
        });
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [mode, search]);

  async function loadMore() {
    setIsLoadingMore(true);
    try {
      const next = await fetchLibraryPage(mode, undefined, images.length);
      setImages((previous) => [...previous, ...next.filter((row) => !previous.some((known) => known.id === row.id))]);
      setHasMore(next.length === PAGE_SIZE);
    } catch (error) {
      setActionError(describeError(error, "Kunde inte hämta fler planritningar.") ?? "");
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function sendBackToVerktyg(image: GeneratedImageRow | undefined) {
    if (!image || isSendingToVerktyg) {
      return;
    }

    setEditingImageId(image.id);
    setIsSendingToVerktyg(true);
    setActionError("");

    try {
      // The plan stays in the library while it is edited; finishing it again republishes it.
      setPendingVerktygSave({
        imageId: image.id,
        imagePath: image.file_path,
      });
      dispatchLibraryUpdated();
      router.push(
        buildVerktygHref(pathname, {
          imageId: image.id,
          imagePath: image.file_path,
        }),
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Kunde inte öppna bilden i verktyg.",
      );
      setIsSendingToVerktyg(false);
      setEditingImageId(null);
    }
  }

  /** Starts an empty plan, or one drawn from `scan` (validated on the server). */
  async function createBlankFloorplan(scan?: unknown) {
    if (isCreatingBlank) {
      return;
    }

    setIsCreatingBlank(true);
    setActionError("");

    try {
      const { image } = await apiJson<{ image: { id: number; file_path: string } }>(
        "/api/blank-floorplan",
        scan === undefined
          ? { method: "POST" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scan }),
            },
      );
      const payload = { imageId: image.id, imagePath: image.file_path };
      setPendingVerktygSave(payload);
      router.push(buildVerktygHref(pathname, payload));
    } catch (error) {
      const fallback =
        scan === undefined ? "Kunde inte skapa en tom planritning." : "Kunde inte importera skanningen.";
      setActionError(describeError(error, fallback) ?? fallback);
      setIsCreatingBlank(false);
    }
  }

  async function importScanFile(file: File | undefined) {
    if (!file) {
      return;
    }

    let scan: unknown;
    try {
      scan = JSON.parse(await file.text());
    } catch {
      setActionError("Skanningsfilen är inte giltig JSON.");
      return;
    }

    // The server validates the contents; the page only checks that it parses.
    await createBlankFloorplan(scan);
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
    if (isDeletingSelected || selectedImageIds.length === 0) {
      return;
    }
    const count = selectedImageIds.length;
    if (!(await confirm(`Ta bort ${count === 1 ? "1 planritning" : `${count} planritningar`}? Originalet tas också bort om ingen annan planritning är gjord av det. Det går inte att ångra.`))) {
      return;
    }

    setActionError("");
    setActionSuccess("");
    setIsDeletingSelected(true);

    const selectedImages = images.filter((image) => selectedImageIds.includes(image.id));
    const deletedIds: number[] = [];
    let failedCount = 0;
    let lastErrorMessage = "";

    try {
      for (const image of selectedImages) {
        try {
          await apiFetch("/api/admin/delete-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: image.id, filePath: image.file_path }),
          });
        } catch (error) {
          failedCount += 1;
          lastErrorMessage = describeError(error, "Kunde inte ta bort bilden.") ?? lastErrorMessage;
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
        reloadLibrary();
        dispatchGenerationUpdated();
      }

      if (failedCount > 0) {
        setActionError(
          failedCount === 1
            ? lastErrorMessage || "Kunde inte ta bort en markerad bild."
            : `Kunde inte ta bort ${failedCount} markerade bilder.`,
        );
      }
    } finally {
      setIsDeletingSelected(false);
    }
  }


  useEffect(() => subscribeToAppEvent(LIBRARY_UPDATED_EVENT, reloadLibrary), [reloadLibrary]);

  // A selection cannot outlive the rows it points at.
  useEffect(() => {
    queueMicrotask(() => {
      setSelectedImageIds((previous) => previous.filter((id) => images.some((row) => row.id === id)));
    });
  }, [images]);
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

  // Latest close handler, so the keyboard effect neither re-subscribes on every render nor
  // closes over a stale one.
  const closeImagePreviewRef = useRef(closeImagePreview);
  useLayoutEffect(() => {
    closeImagePreviewRef.current = closeImagePreview;
  });

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

        closeImagePreviewRef.current();
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
    <section
      className={
        embedded
          ? "w-full"
          : "flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-4 py-6 sm:px-6 sm:py-10"
      }
    >
      <div className="w-full rounded-none border border-[#d8d2c8] bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {embedded ? (
              <h2 className="text-lg font-semibold text-[#3d3a36]">{config.title}</h2>
            ) : (
              <h1 className="text-2xl font-semibold text-[#3d3a36]">{config.title}</h1>
            )}
            {config.intro ? <p className="mt-1 text-sm text-[#6a6258]">{config.intro}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                if (!event.target.value.trim()) setSearchResults(null);
              }}
              placeholder="Sök adress"
              aria-label="Sök planritning på adress"
              className="h-8 w-48 rounded-none border border-[#d8d2c8] bg-white px-2 text-xs text-[#4d463f]"
            />
            {mode === "scans" ? (
              <>
            <button
              type="button"
              onClick={() => void createBlankFloorplan()}
              disabled={isCreatingBlank}
              className="inline-flex items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCreatingBlank ? (
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus size={12} aria-hidden="true" />
              )}
              {isCreatingBlank ? "Skapar..." : "Ny tom planritning"}
            </button>
            <button
              type="button"
              onClick={() => scanInputRef.current?.click()}
              disabled={isCreatingBlank}
              className="inline-flex items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload size={12} aria-hidden="true" />
              Importera skanning
            </button>
            <input
              ref={scanInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Välj skanningsfil"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so picking the same file again still fires a change.
                event.target.value = "";
                void importScanFile(file);
              }}
            />
              </>
            ) : null}
                          <>
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
              </>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-none border border-[#d8d2c8] bg-[#f7f4ef] px-4 py-6 text-[#6a6258]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <p className="text-sm font-medium">Hämtar planritningar...</p>
          </div>
        ) : null}

        {isRefreshing ? (
          <p
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-[#7b746a]"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Uppdaterar listan...
          </p>
        ) : null}

        {loadError || actionError ? (
          <p className="mt-6 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionError || loadError}
          </p>
        ) : null}
        {actionSuccess ? (
          <p className="mt-6 rounded-none border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {actionSuccess}
          </p>
        ) : null}

        {!isLoading && !loadError && shownImages.length === 0 ? (
          <p className="mt-6 text-sm text-[#6a6258]">
            {searchResults ? "Inga planritningar matchar sökningen." : config.empty}
          </p>
        ) : null}

        {!isLoading && !loadError && shownImages.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shownImages.map((image, imageIndex) => {
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
                    <p className="text-xs font-semibold text-[#6a6258]">{planDisplayName(image)}</p>
                    <span
                      className={`rounded-none px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        image.published_at ? "bg-[#e6efe3] text-[#3f5a37]" : "bg-[#f3eadb] text-[#7a5b2e]"
                      }`}
                    >
                      {image.published_at ? "Färdig" : mode === "scans" ? "Pågående" : "Ej slutförd"}
                    </span>
                    <label className="inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={isMarked}
                          onChange={() => toggleImageSelection(image.id)}
                          disabled={isDeletingSelected}
                          className="h-5 w-5 rounded border-[#b7aea1] text-[#8b7355] focus:ring-[#8b7355]"
                        />
                      </label>
                  </div>
                </div>

                <div className="bg-[#f0ece6] p-4">
                  <button
                    type="button"
                    onClick={() => openImagePreview(image.id)}
                    disabled={!image.preview_url}
                    className="block w-full cursor-zoom-in disabled:cursor-default"
                  >
                    <ThumbnailImage
                      src={image.preview_url}
                      alt={planDisplayName(image)}
                      onPrefetch={() => prefetchImage(image.full_url)}
                      heightClassName="h-[220px]"
                      sizes={"(max-width: 768px) 90vw, (max-width: 1280px) 45vw, 30vw"}
                      priority={imageIndex < 3}
                    />
                  </button>
                </div>

                <div className="flex items-center border-t border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
                  {image.can_edit ? (
<button
                    type="button"
                    onClick={() => void sendBackToVerktyg(image)}
                    disabled={isSendingToVerktyg}
                    className="inline-flex h-8 items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-3 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {editingImageId === image.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        Öppnar...
                      </>
                    ) : (
                      <>
                        <Pencil size={13} aria-hidden="true" />
                        Redigera
                      </>
                    )}
                  </button>
                  ) : null}
                </div>
              </article>
              );
            })}
          </div>
        ) : null}

        {!searchResults && hasMore && images.length >= PAGE_SIZE ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={isLoadingMore}
            className="mt-4 self-center rounded-none border border-[#d8d2c8] bg-white px-4 py-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:opacity-60"
          >
            {isLoadingMore ? "Hämtar..." : "Visa fler"}
          </button>
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
                {planDisplayName(previewImage)}
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
                    // Only finished plans are delivered, so every download is a billed plan.
                    disabled={isPreviewDownloading || !previewImage.published_at}
                    title={previewImage.published_at ? undefined : "Slutför planritningen för att ladda ner den."}
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
                      alt={planDisplayName(previewImage)}
                      heightClassName="h-[45vh] sm:h-[calc(90vh-190px)]"
                      sizes="(max-width: 1024px) 95vw, 80vw"
                      priority
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center border-t border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
              {previewImage.can_edit ? (
<button
                type="button"
                onClick={() => void sendBackToVerktyg(previewImage)}
                disabled={isSendingToVerktyg}
                className="inline-flex h-8 items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-3 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSendingToVerktyg ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Redigerar...
                  </>
                ) : (
                  <>
                    <Pencil size={13} aria-hidden="true" />
                    Redigera
                  </>
                )}
              </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {confirmDialog}
    </section>
  );
}

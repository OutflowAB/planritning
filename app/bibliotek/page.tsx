"use client";

import {
  ChevronDown,
  Download,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TouchEvent, WheelEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getStoredRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/format-date";
import {
  exportFloorImagesToPdf,
  exportLibraryFloorplan,
  type LibraryExportFormat,
} from "@/lib/floorplan/export-library";
import { ThumbnailImage } from "@/components/ui/thumbnail-image";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EditableTitle } from "@/components/ui/editable-title";
import { saveImageLabel } from "@/lib/image-label";
import { searchable } from "@/lib/search-text";
import { Page, PageHeader } from "@/components/layout/page";
import { floorLabel, groupLibraryItems, parseFloorGroup, type LibraryEntry } from "@/lib/floor-groups";
import { imageDisplayName, imageDownloadBaseName } from "@/lib/image-naming";
import { apiFetch, apiJson, describeError } from "@/lib/api-client";
import { imageUrl } from "@/lib/image-url";
import { prefetchImage } from "@/lib/prefetch-image";
import { dispatchGenerationUpdated, dispatchLibraryUpdated, LIBRARY_UPDATED_EVENT, subscribeToAppEvent } from "@/lib/app-events";
import { useCachedList } from "@/lib/use-cached-list";
import type { ImageListItem } from "@/app/api/images/route";
import { buildVerktygHref, setPendingVerktygSave } from "@/lib/verktyg-save-session";

const LIBRARY_LIST_CACHE_KEY = "library-list-cache-v2";
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.5;
const DOWNLOAD_FORMATS: Array<{ format: LibraryExportFormat; label: string }> = [
  { format: "svg", label: "SVG" },
  { format: "pdf", label: "PDF" },
  { format: "jpg", label: "JPG" },
  { format: "jpeg", label: "JPEG" },
];

type HouseEntry = Extract<LibraryEntry<GeneratedImageRow>, { kind: "group" }>;

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
  label: string | null;
  source_upload_id: number | null;
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
    preview_url: isImage ? imageUrl(item.id, "thumb", item.version) : null,
    full_url: isImage ? imageUrl(item.id, "full", item.version) : null,
    label: item.label ?? null,
    source_upload_id: item.source_upload_id ?? null,
  };
}

async function fetchLibrary(signal: AbortSignal): Promise<GeneratedImageRow[]> {
  const { items } = await apiJson<{ items: ImageListItem[] }>("/api/images?kind=generated&saved=1", {
    signal,
  });
  return items.map(withImageUrls);
}

function matchesSearch(row: GeneratedImageRow, needle: string) {
  return searchable(
    [row.label ?? "", imageDisplayName(row.id), String(row.id), formatDateTime(row.created_at)].join(" "),
  ).includes(needle);
}

function filterEntries(entries: LibraryEntry<GeneratedImageRow>[], query: string) {
  const needle = searchable(query.trim());
  if (!needle) {
    return entries;
  }
  return entries.filter((entry) =>
    entry.kind === "single"
      ? matchesSearch(entry.item, needle)
      : entry.floors.some((floor) => matchesSearch(floor.item, needle)),
  );
}

type LibraryFilter = "all" | "named" | "unnamed" | "houses";
type LibrarySort = "newest" | "oldest" | "name";

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "Alla" },
  { id: "named", label: "Namngivna" },
  { id: "unnamed", label: "Utan namn" },
  { id: "houses", label: "Flera våningar" },
];

function entryRows(entry: LibraryEntry<GeneratedImageRow>) {
  return entry.kind === "single" ? [entry.item] : entry.floors.map((floor) => floor.item);
}

function entryLabel(entry: LibraryEntry<GeneratedImageRow>) {
  return entryRows(entry).find((row) => row.label)?.label ?? null;
}

function entryTime(entry: LibraryEntry<GeneratedImageRow>) {
  return Math.max(...entryRows(entry).map((row) => new Date(row.created_at).getTime()));
}

function filterAndSort(
  entries: LibraryEntry<GeneratedImageRow>[],
  filter: LibraryFilter,
  sort: LibrarySort,
) {
  const kept = entries.filter((entry) =>
    filter === "named"
      ? entryLabel(entry) !== null
      : filter === "unnamed"
        ? entryLabel(entry) === null
        : filter === "houses"
          ? entry.kind === "group"
          : true,
  );
  if (sort === "oldest") {
    return [...kept].sort((a, b) => entryTime(a) - entryTime(b));
  }
  if (sort === "name") {
    // Named first, alphabetically; unnamed after, newest first.
    return [...kept].sort((a, b) => {
      const labelA = entryLabel(a);
      const labelB = entryLabel(b);
      if (labelA && labelB) return labelA.localeCompare(labelB, "sv-SE", { numeric: true });
      if (labelA) return -1;
      if (labelB) return 1;
      return entryTime(b) - entryTime(a);
    });
  }
  return kept;
}

export default function BibliotekPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canDelete = pathname.startsWith("/admin") || getStoredRole() === "admin";
  const newPlanHref = "/startsida";
  const {
    items: images,
    setItems: setImages,
    isLoading,
    isRefreshing,
    error: loadError,
    reload: reloadLibrary,
  } = useCachedList<GeneratedImageRow>(LIBRARY_LIST_CACHE_KEY, fetchLibrary, "Kunde inte hämta biblioteket.");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [selectedImageIds, setSelectedImageIds] = useState<number[]>([]);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isPreviewDownloading, setIsPreviewDownloading] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<LibraryExportFormat | null>(null);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [isSendingToVerktyg, setIsSendingToVerktyg] = useState(false);
  // Which card triggered the edit, so only that button shows a spinner.
  const [editingImageId, setEditingImageId] = useState<number | null>(null);
  // Houses (the floors of one scan) shown opened up, and the one being downloaded.
  const [expandedRuns, setExpandedRuns] = useState<string[]>([]);
  const [downloadingRun, setDownloadingRun] = useState<string | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const allEntries = groupLibraryItems(images);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("newest");
  const entries = filterAndSort(filterEntries(allEntries, searchQuery), filter, sort);
  const isNarrowed = searchQuery.trim() !== "" || filter !== "all";
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
        fileName: imageDownloadBaseName(previewImage.id),
        format,
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

  async function sendBackToVerktyg(image: GeneratedImageRow | undefined) {
    if (!image || isSendingToVerktyg) {
      return;
    }

    setEditingImageId(image.id);
    setIsSendingToVerktyg(true);
    setActionError("");

    try {
      await apiFetch("/api/unsave-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: image.id, filePath: image.file_path }),
      });

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


  /** Names plans (and the originals they were drawn from), then shows the name right away. */
  async function renameImages(rows: GeneratedImageRow[], label: string | null) {
    const ids = rows.flatMap((row) => (row.source_upload_id ? [row.id, row.source_upload_id] : [row.id]));
    const saved = await saveImageLabel(ids, label);
    if (saved) {
      const renamed = new Set(rows.map((row) => row.id));
      setImages((previous) =>
        previous.map((row) => (renamed.has(row.id) ? { ...row, label } : row)),
      );
    }
    return saved;
  }

  function renderImageCard(image: GeneratedImageRow, imageIndex: number, floorText?: string) {
    const isMarked = selectedImageIds.includes(image.id);

    return (
    <article
      key={image.id}
      id={`library-image-${image.id}`}
      className={`group flex flex-col overflow-hidden rounded-xl border bg-white transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(28,25,23,0.22)] ${
        selectedImage?.id === image.id || isMarked
          ? "border-accent ring-2 ring-accent/20"
          : "border-stone-200 shadow-[0_1px_2px_rgba(28,25,23,0.04)]"
      }`}
    >
      <div className="relative flex flex-1 items-center bg-stone-100/70 px-6 py-5">
        <button
          type="button"
          onClick={() => openImagePreview(image.id)}
          disabled={!image.preview_url}
          aria-label={`Förhandsgranska ${imageDisplayName(image.id)}`}
          className="block w-full cursor-zoom-in rounded-md disabled:cursor-default"
        >
          <ThumbnailImage
            src={image.preview_url}
            alt={imageDisplayName(image.id)}
            onPrefetch={() => prefetchImage(image.full_url)}
            heightClassName="h-[240px]"
            frameClassName="bg-transparent [&_img]:drop-shadow-[0_6px_14px_rgba(28,25,23,0.16)]"
            sizes={"(max-width: 768px) 90vw, (max-width: 1280px) 45vw, 30vw"}
            priority={imageIndex < 3}
          />
        </button>
        {floorText ? (
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-stone-700 shadow-sm ring-1 ring-stone-200/70 backdrop-blur">
            {floorText}
          </span>
        ) : null}
        {canDelete ? (
          <label
            className={`absolute right-3 top-3 inline-flex rounded-md bg-white/90 p-1 shadow-sm ring-1 ring-stone-200/70 transition ${
              isMarked ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
            }`}
          >
            <input
              type="checkbox"
              checked={isMarked}
              onChange={() => toggleImageSelection(image.id)}
              disabled={isDeletingSelected}
              aria-label={`Markera ${imageDisplayName(image.id)}`}
              className="h-4 w-4 rounded border-stone-300 accent-[var(--tenant-accent)]"
            />
          </label>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-4 py-3">
        <div className="min-w-0">
          <EditableTitle
            value={image.label}
            fallback={imageDisplayName(image.id)}
            onSave={(label) => renameImages([image], label)}
          />
          <p className="mt-0.5 whitespace-nowrap text-xs text-stone-500 tabular-nums">
            {image.label ? `${imageDisplayName(image.id)} · ` : ""}
            {formatDateTime(image.created_at)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void sendBackToVerktyg(image)}
          disabled={isSendingToVerktyg}
          className={buttonClass("secondary", "sm")}
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
      </div>
    </article>
    );
  }

  function toggleHouse(run: string) {
    setExpandedRuns((previous) =>
      previous.includes(run) ? previous.filter((entry) => entry !== run) : [...previous, run],
    );
  }

  function toggleHouseSelection(ids: number[]) {
    setSelectedImageIds((previous) =>
      ids.every((id) => previous.includes(id))
        ? previous.filter((id) => !ids.includes(id))
        : [...new Set([...previous, ...ids])],
    );
  }

  async function downloadHouse(entry: HouseEntry) {
    if (downloadingRun) {
      return;
    }
    const urls = entry.floors.flatMap((floor) => (floor.item.full_url ? [floor.item.full_url] : []));
    setDownloadingRun(entry.run);
    setActionError("");
    try {
      await exportFloorImagesToPdf(urls, `planritning-${entry.run}`);
    } catch {
      setActionError("Kunde inte ladda ner våningarna just nu.");
    } finally {
      setDownloadingRun(null);
    }
  }

  function renderHouse(entry: HouseEntry) {
    const expanded = expandedRuns.includes(entry.run);
    const ids = entry.floors.map((floor) => floor.item.id);
    const allMarked = ids.every((id) => selectedImageIds.includes(id));
    const cover = entry.floors[0].item;
    const houseLabel = entry.floors.find((floor) => floor.item.label)?.item.label ?? null;
    const title = `${houseLabel ?? "Polycam-skanning"} · ${entry.floors.length} våningar`;
    const renameHouse = (label: string | null) =>
      renameImages(
        entry.floors.map((floor) => floor.item),
        label,
      );
    const downloadButton = (
      <button
        type="button"
        onClick={() => void downloadHouse(entry)}
        disabled={downloadingRun !== null}
        aria-label="Ladda ner alla våningar som PDF"
        title="Ladda ner alla våningar som PDF"
        className={iconButtonClass("secondary")}
      >
        {downloadingRun === entry.run ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Download size={14} aria-hidden="true" />
        )}
      </button>
    );
    const selectBox = canDelete ? (
      <label
        className={`inline-flex rounded-md bg-white/90 p-1 shadow-sm ring-1 ring-stone-200/70 transition ${
          allMarked ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
        }`}
        title="Markera alla våningar"
      >
        <input
          type="checkbox"
          checked={allMarked}
          onChange={() => toggleHouseSelection(ids)}
          disabled={isDeletingSelected}
          aria-label={`Markera ${title}`}
          className="h-4 w-4 rounded border-stone-300 accent-[var(--tenant-accent)]"
        />
      </label>
    ) : null;

    if (expanded) {
      return (
        <section
          key={entry.run}
          data-testid="house-group"
          aria-label={title}
          className="group col-span-full overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
            <div className="min-w-0">
              <EditableTitle
                value={houseLabel}
                fallback="Polycam-skanning"
                onSave={renameHouse}
                className="[&_span]:font-semibold"
              />
              <p className="mt-0.5 text-xs text-stone-500 tabular-nums">
                {entry.floors.length} våningar · {formatDateTime(cover.created_at)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectBox}
              {downloadButton}
              <button
                type="button"
                onClick={() => toggleHouse(entry.run)}
                aria-expanded="true"
                className={buttonClass("ghost", "sm")}
              >
                <ChevronDown size={13} className="rotate-180" aria-hidden="true" />
                Dölj
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-5 bg-stone-50/60 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {entry.floors.map((floor) =>
              renderImageCard(
                floor.item,
                images.indexOf(floor.item),
                floorLabel(floor.position, floor.total),
              ),
            )}
          </div>
        </section>
      );
    }

    return (
      <div key={entry.run} data-testid="house-group" className="group relative flex pb-2.5 pr-2.5">
        <div aria-hidden="true" className="absolute inset-0 translate-x-2.5 translate-y-2.5 rounded-xl border border-stone-200 bg-stone-100 transition duration-200 group-hover:translate-x-3 group-hover:translate-y-3" />
        <div aria-hidden="true" className="absolute inset-0 translate-x-[5px] translate-y-[5px] rounded-xl border border-stone-200 bg-stone-50 transition duration-200 group-hover:translate-x-1.5 group-hover:translate-y-1.5" />
        <article
          aria-label={title}
          className={`relative flex flex-1 flex-col overflow-hidden rounded-xl border bg-white transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_12px_32px_-12px_rgba(28,25,23,0.22)] ${
            allMarked ? "border-accent ring-2 ring-accent/20" : "border-stone-200"
          }`}
        >
          <div className="relative flex flex-1 items-center bg-stone-100/70 px-6 py-5">
            <button
              type="button"
              onClick={() => toggleHouse(entry.run)}
              aria-expanded="false"
              aria-label={`Visa våningarna i ${title}`}
              className="block w-full cursor-pointer rounded-md"
            >
              <ThumbnailImage
                src={cover.preview_url}
                alt={title}
                heightClassName="h-[240px]"
                frameClassName="bg-transparent [&_img]:drop-shadow-[0_6px_14px_rgba(28,25,23,0.16)]"
                sizes={"(max-width: 768px) 90vw, (max-width: 1280px) 45vw, 30vw"}
              />
            </button>
            <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-stone-900/85 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur">
              {entry.floors.length} våningar
            </span>
            <div className="absolute right-3 top-3">{selectBox}</div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-4 py-3">
            <div className="min-w-0">
              <EditableTitle value={houseLabel} fallback="Polycam-skanning" onSave={renameHouse} />
              <p className="mt-0.5 whitespace-nowrap text-xs text-stone-500 tabular-nums">{formatDateTime(cover.created_at)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {downloadButton}
              <button
                type="button"
                onClick={() => toggleHouse(entry.run)}
                aria-expanded="false"
                aria-label="Visa våningarna"
                title="Visa våningarna"
                className={iconButtonClass("secondary")}
              >
                <ChevronDown size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        </article>
      </div>
    );
  }

  useEffect(() => subscribeToAppEvent(LIBRARY_UPDATED_EVENT, reloadLibrary), [reloadLibrary]);

  // A selection cannot outlive the rows it points at.
  useEffect(() => {
    queueMicrotask(() => {
      setSelectedImageIds((previous) => previous.filter((id) => images.some((row) => row.id === id)));
    });
  }, [images]);
  // A floor that is being pointed at (a redirect after approving, a preview link) needs its
  // house opened, or there is no card to scroll to.
  const focusedRun = parseFloorGroup((selectedImage ?? previewImage)?.file_path)?.run;
  useEffect(() => {
    if (!focusedRun) {
      return;
    }
    queueMicrotask(() => {
      setExpandedRuns((previous) => (previous.includes(focusedRun) ? previous : [...previous, focusedRun]));
    });
  }, [focusedRun]);

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
    <Page width="wide">
      <PageHeader
        title="Planritningar"
        eyebrow={
          !isLoading && images.length > 0 ? (
            <span className="tabular-nums">
              {allEntries.length} objekt · {images.length}{" "}
              {images.length === 1 ? "ritning" : "ritningar"}
            </span>
          ) : null
        }
        description="Färdiga planritningar, klara att ladda ner. Klicka på en ritning för att förhandsgranska den."
        actions={
          <>
            {canDelete && images.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={toggleSelectAllImages}
                  disabled={isDeletingSelected}
                  className={buttonClass("ghost")}
                >
                  {selectedImageIds.length === images.length ? "Avmarkera alla" : "Markera alla"}
                </button>
                {selectedImageIds.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void handleDeleteSelectedImages()}
                    disabled={isDeletingSelected}
                    className={buttonClass("danger")}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {isDeletingSelected ? "Tar bort..." : `Ta bort ${selectedImageIds.length}`}
                  </button>
                ) : null}
              </>
            ) : null}
            <Link href={newPlanHref} className={buttonClass("primary")}>
              <Plus size={15} aria-hidden="true" />
              Ny planritning
            </Link>
          </>
        }
      />

      {isRefreshing ? (
        <p
          className="-mt-3 mb-4 inline-flex items-center gap-1.5 text-xs text-stone-500"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Uppdaterar...
        </p>
      ) : null}

      {!isLoading && images.length > 0 ? (
        <div className="mb-5 flex flex-wrap items-center gap-2.5">
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Sök planritningar</span>
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Sök på adress, namn eller bildnummer"
              className="h-8 w-full rounded-lg border border-stone-200 bg-white pl-9 pr-3 text-[13px] text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.04)] outline-none transition placeholder:text-stone-400 hover:border-stone-300 focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </label>
          <div className="flex items-center gap-0.5 rounded-lg border border-stone-200 bg-white p-0.5 shadow-[0_1px_2px_rgba(28,25,23,0.04)]" role="group" aria-label="Filtrera">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                aria-pressed={filter === option.id}
                className={`h-7 rounded-md px-2.5 text-xs font-medium transition ${
                  filter === option.id ? "bg-primary text-primary-fg shadow-sm" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-2 text-xs text-stone-500">
            Sortera
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as LibrarySort)}
              className="h-8 rounded-lg border border-stone-200 bg-white px-2 text-[13px] text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.04)] outline-none hover:border-stone-300 focus:border-accent focus:ring-4 focus:ring-accent/15"
            >
              <option value="newest">Nyast först</option>
              <option value="oldest">Äldst först</option>
              <option value="name">Namn A–Ö</option>
            </select>
          </label>
          {isNarrowed ? (
            <p className="w-full text-xs text-stone-500 tabular-nums">
              Visar {entries.length} av {allEntries.length}
            </p>
          ) : null}
        </div>
      ) : null}

      {loadError || actionError ? (
        <p className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {actionError || loadError}
        </p>
      ) : null}
      {actionSuccess ? (
        <p className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
          {actionSuccess}
        </p>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              <div className="h-[280px] animate-pulse bg-stone-100" />
              <div className="space-y-2 px-4 py-3.5">
                <div className="h-3.5 w-24 animate-pulse rounded bg-stone-100" />
                <div className="h-3 w-32 animate-pulse rounded bg-stone-100" />
              </div>
            </div>
          ))}
          <span className="sr-only">Hämtar planritningar...</span>
        </div>
      ) : null}

      {!isLoading && !loadError && images.length === 0 ? (
        <EmptyState
          title="Inga planritningar ännu"
          description="Ladda upp en gammal ritning eller klistra in en Polycam-länk, så ritas den om i er stil på någon minut."
          action={
            <Link href={newPlanHref} className={buttonClass("primary")}>
              <Plus size={15} aria-hidden="true" />
              Skapa första planritningen
            </Link>
          }
        />
      ) : null}

      {!isLoading && !loadError && images.length > 0 && entries.length === 0 ? (
        <EmptyState
          title="Inga träffar"
          description={
            searchQuery.trim()
              ? `Ingen planritning matchar "${searchQuery.trim()}" med det här filtret.`
              : "Inga planritningar passar det här filtret."
          }
          action={
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setFilter("all");
              }}
              className={buttonClass("secondary")}
            >
              Visa alla
            </button>
          }
        />
      ) : null}

      {!isLoading && !loadError && entries.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map((entry) => {
            if (entry.kind === "single") {
              return renderImageCard(entry.item, images.indexOf(entry.item));
            }
            return renderHouse(entry);
          })}
        </div>
      ) : null}

      {previewImage?.preview_url ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={closeImagePreview}
          role="presentation"
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg border border-stone-200 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 bg-stone-50 px-3 py-2">
              <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-stone-600">
                {imageDisplayName(previewImage.id)}
              </div>
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
                {previewZoom !== 1 ? (
                  <button
                    type="button"
                    onClick={resetPreviewZoom}
                    aria-label="Återställ zoom"
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100"
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
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Download size={13} aria-hidden="true" />
                    {isPreviewDownloading ? "Laddar..." : "Ladda ner"}
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>

                  {showDownloadMenu ? (
                    <div
                      role="menu"
                      aria-label="Välj filformat"
                      className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-stone-200 bg-white"
                    >
                      {DOWNLOAD_FORMATS.map(({ format, label }, index) => (
                        <button
                          key={format}
                          type="button"
                          role="menuitem"
                          disabled={isPreviewDownloading}
                          onClick={() => void downloadPreviewImage(format)}
                          className={`flex h-8 w-full items-center justify-between px-2 text-left text-xs font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60 ${
                            index < DOWNLOAD_FORMATS.length - 1 ? "border-b border-stone-200" : ""
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
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 transition hover:bg-stone-100"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-stone-100 p-4">
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
                      heightClassName="h-[45vh] sm:h-[calc(90vh-190px)]"
                      sizes="(max-width: 1024px) 95vw, 80vw"
                      priority
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center border-t border-stone-100 bg-stone-50 px-3 py-2">
              <button
                type="button"
                onClick={() => void sendBackToVerktyg(previewImage)}
                disabled={isSendingToVerktyg}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
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
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}

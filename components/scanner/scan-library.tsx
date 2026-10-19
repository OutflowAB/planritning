"use client";

import { FileUp, Loader2, Pencil, Plus, Smartphone, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";

import type { ImageListItem } from "@/app/api/images/route";
import { Page, PageHeader } from "@/components/layout/page";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ThumbnailImage } from "@/components/ui/thumbnail-image";
import { apiFetch, apiJson, describeError } from "@/lib/api-client";
import { dispatchLibraryUpdated } from "@/lib/app-events";
import { getStoredRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/format-date";
import { imageDisplayName } from "@/lib/image-naming";
import { imageUrl } from "@/lib/image-url";
import { useCachedList } from "@/lib/use-cached-list";
import { buildVerktygHref, setPendingVerktygSave } from "@/lib/verktyg-save-session";

const SCAN_LIST_CACHE_KEY = "scan-list-cache-v1";
// The server refuses more; a real scan is a few kilobytes.
const MAX_SCAN_FILE_BYTES = 2_000_000;
// A piece of a 3D mesh stays under the server's 4 MB request cap.
const MESH_PART_BYTES = 3_500_000;

async function fetchScans(signal: AbortSignal): Promise<ImageListItem[]> {
  const { items } = await apiJson<{ items: ImageListItem[] }>("/api/images?kind=scans", { signal });
  return items;
}

function subscribeToNothing() {
  return () => {};
}

/** The address the iPhone app should send to: this site, as the browser sees it. */
function useSiteAddress() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => "",
  );
}

/**
 * Plans started from a LiDAR scan (the SM Skanner iPhone app, or its .json file) or from a blank
 * page. Each opens in Verktyg; once saved there it is listed under Planritningar as well.
 */
export function ScanLibrary() {
  const router = useRouter();
  const pathname = usePathname();
  const siteAddress = useSiteAddress();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { items: scans, isLoading, error, reload, setItems } = useCachedList(
    SCAN_LIST_CACHE_KEY,
    fetchScans,
    "Kunde inte hämta skanningarna.",
  );
  const [isCreating, setIsCreating] = useState(false);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const canDelete = useSyncExternalStore(
    subscribeToNothing,
    () => getStoredRole() === "admin",
    () => false,
  );

  function openInVerktyg(payload: { imageId: number; imagePath: string }) {
    setPendingVerktygSave(payload);
    router.push(buildVerktygHref(pathname, payload));
  }

  /** Starts an empty plan, or one drawn from `scan` (validated on the server), with its 3D mesh if given. */
  async function createPlan(scan?: unknown, model?: File) {
    if (isCreating) {
      return;
    }
    setIsCreating(true);
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
      if (model) {
        // In pieces, as from the phone, to stay under the server's request limit.
        const parts = Math.max(1, Math.ceil(model.size / MESH_PART_BYTES));
        for (let part = 0; part < parts; part++) {
          await apiFetch(`/api/scan-mesh?imageId=${image.id}&part=${part}&parts=${parts}`, {
            method: "PUT",
            body: model.slice(part * MESH_PART_BYTES, (part + 1) * MESH_PART_BYTES),
          });
        }
      }
      dispatchLibraryUpdated();
      openInVerktyg({ imageId: image.id, imagePath: image.file_path });
    } catch (createError) {
      const fallback =
        scan === undefined ? "Kunde inte skapa en tom planritning." : "Kunde inte importera skanningen.";
      setActionError(describeError(createError, fallback) ?? fallback);
      setIsCreating(false);
    }
  }

  /** The scan file and, if picked with it, the 3D mesh (`-3d.bin`); RoomPlan's raw data and the mesh summary are not needed. */
  async function importScanFiles(files: File[]) {
    const file = files.find((candidate) => candidate.name.endsWith(".json") && !/-(roomplan|mesh)\.json$/.test(candidate.name));
    const model = files.find((candidate) => candidate.name.endsWith(".bin"));
    if (!file) {
      setActionError("Välj skanningsfilen (den som inte slutar på -roomplan eller -mesh).");
      return;
    }
    if (file.size > MAX_SCAN_FILE_BYTES) {
      setActionError("Skanningsfilen är för stor.");
      return;
    }

    let scan: unknown;
    try {
      scan = JSON.parse(await file.text());
    } catch {
      setActionError("Filen är inte en skanning. Välj skanning-….json från SM Skanner.");
      return;
    }
    // A wrapped file ({ "scan": … }) is accepted as well as the bare scan.
    const unwrapped =
      scan && typeof scan === "object" && "scan" in scan ? (scan as { scan: unknown }).scan : scan;
    await createPlan(unwrapped, model);
  }

  async function openScan(scan: ImageListItem) {
    if (openingId !== null) {
      return;
    }
    setOpeningId(scan.id);
    setActionError("");

    try {
      // A plan saved to Planritningar goes back to work in progress while it is edited, as it
      // does when it is opened from the library.
      if (scan.saved_at) {
        await apiFetch("/api/unsave-generation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId: scan.id, filePath: scan.file_path }),
        });
        dispatchLibraryUpdated();
      }
      openInVerktyg({ imageId: scan.id, imagePath: scan.file_path });
    } catch (openError) {
      setActionError(describeError(openError, "Kunde inte öppna skanningen.") ?? "");
      setOpeningId(null);
    }
  }

  async function deleteScan(scan: ImageListItem) {
    if (deletingId !== null || !window.confirm(`Ta bort ${scan.label ?? imageDisplayName(scan.id)}?`)) {
      return;
    }
    setDeletingId(scan.id);
    setActionError("");

    try {
      await apiFetch("/api/admin/delete-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: scan.id, filePath: scan.file_path }),
      });
      setItems((previous) => previous.filter((item) => item.id !== scan.id));
      dispatchLibraryUpdated();
    } catch (deleteError) {
      setActionError(describeError(deleteError, "Kunde inte ta bort skanningen.") ?? "");
    } finally {
      setDeletingId(null);
    }
  }

  const importButton = (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      disabled={isCreating}
      className={buttonClass("primary")}
    >
      {isCreating ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
      Importera skanning
    </button>
  );

  return (
    <Page width="wide">
      <PageHeader
        title="Skannare"
        description="Planritningar från en LiDAR-skanning med iPhone. Skanningen blir väggar, dörrar, fönster, rum och fasta inredningar som går att redigera i Verktyg."
        eyebrow={scans.length > 0 ? `${scans.length} ${scans.length === 1 ? "skanning" : "skanningar"}` : undefined}
        actions={
          <>
            <button
              type="button"
              onClick={() => void createPlan()}
              disabled={isCreating}
              className={buttonClass("secondary")}
            >
              <Plus size={14} />
              Ny tom planritning
            </button>
            {importButton}
          </>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.bin,application/json"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) void importScanFiles(files);
        }}
      />

      <div className="mb-5 flex items-start gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
        <Smartphone size={16} className="mt-0.5 shrink-0 text-stone-500" aria-hidden="true" />
        <p className="text-[13px] leading-5 text-stone-600">
          Skanna med appen <span className="font-medium text-stone-900">SM Skanner</span> och tryck{" "}
          <span className="font-medium text-stone-900">Skicka till webbappen</span> med adressen{" "}
          {siteAddress ? (
            <code className="rounded bg-stone-100 px-1 py-0.5 text-[12px] text-stone-800">{siteAddress}</code>
          ) : (
            "till den här sidan"
          )}{" "}
          och samma inloggning som här. Eller dela skanningen som fil och importera{" "}
          <span className="font-medium text-stone-900">skanning-….json</span>.
        </p>
      </div>

      {actionError || error ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          <span>{actionError || error}</span>
          {!actionError && error ? (
            <button type="button" onClick={reload} className={buttonClass("secondary", "sm")}>
              Försök igen
            </button>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-[300px] animate-pulse rounded-xl border border-stone-200 bg-white" />
          ))}
        </div>
      ) : scans.length === 0 ? (
        <EmptyState
          title="Inga skanningar ännu"
          description="Skicka en skanning från iPhone-appen eller importera en skanningsfil, så blir den en redigerbar planritning här."
          action={importButton}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {scans.map((scan, index) => {
            const name = scan.label ?? imageDisplayName(scan.id);
            const isOpening = openingId === scan.id;
            return (
              <article
                key={scan.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(28,25,23,0.22)]"
              >
                <button
                  type="button"
                  onClick={() => void openScan(scan)}
                  disabled={openingId !== null}
                  aria-label={`Öppna ${name} i Verktyg`}
                  className="relative block bg-stone-100/70 px-6 py-5 disabled:cursor-wait"
                >
                  <ThumbnailImage
                    src={imageUrl(scan.id, "thumb", scan.version)}
                    alt={name}
                    heightClassName="h-[220px]"
                    frameClassName="bg-transparent [&_img]:drop-shadow-[0_6px_14px_rgba(28,25,23,0.16)]"
                    sizes="(max-width: 768px) 90vw, (max-width: 1280px) 45vw, 30vw"
                    priority={index < 3}
                  />
                  <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-stone-700 shadow-sm ring-1 ring-stone-200/70 backdrop-blur">
                    {scan.saved_at ? "Sparad" : "Pågående"}
                  </span>
                </button>
                <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-stone-900">{name}</p>
                    <p className="text-xs text-stone-500">{formatDateTime(scan.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => void deleteScan(scan)}
                        disabled={deletingId !== null}
                        aria-label={`Ta bort ${name}`}
                        className={iconButtonClass("ghost")}
                      >
                        {deletingId === scan.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void openScan(scan)}
                      disabled={openingId !== null}
                      className={buttonClass("secondary", "sm")}
                    >
                      {isOpening ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
                      Redigera
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Page>
  );
}

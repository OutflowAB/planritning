"use client";

import { ThumbnailImage } from "@/components/ui/thumbnail-image";
import { Check, ChevronLeft, ChevronRight, Loader2, Minus, Plus, X } from "lucide-react";
import { TouchEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiJson, describeError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format-date";
import { Page, PageHeader } from "@/components/layout/page";
import { imageUrl } from "@/lib/image-url";
import { imageDisplayName } from "@/lib/image-naming";

const SEK_PER_GENERATION = 50;
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.5;

type PeriodKey = "today" | "current_week" | "current_month";

const periodLabels: Record<PeriodKey, string> = {
  today: "Dag",
  current_week: "Vecka",
  current_month: "Månad",
};
const periodOptions: PeriodKey[] = ["today", "current_week", "current_month"];
const monthLabelFormatter = new Intl.DateTimeFormat("sv-SE", {
  month: "long",
});
const weekDayFormatter = new Intl.DateTimeFormat("sv-SE", {
  weekday: "long",
});

function capitalizeFirstLetter(value: string) {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getIsoWeekNumber(date: Date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return weekNumber;
}

type GenerationLogRow = {
  id: number;
  file_name: string;
  file_path: string;
  created_at: string;
  version: string | null;
};

export default function FaktureringPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>("current_month");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);
  const [generationCount, setGenerationCount] = useState(0);
  const [generationLogs, setGenerationLogs] = useState<GenerationLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [previewLog, setPreviewLog] = useState<GenerationLogRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const periodMenuRef = useRef<HTMLDivElement | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  const totalCostSek = generationCount * SEK_PER_GENERATION;

  const periodRange = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (selectedPeriod === "today") {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() + periodOffset);
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      return { start, end };
    }

    if (selectedPeriod === "current_week") {
      const dayOfWeek = startOfToday.getDay();
      const diffToMonday = (dayOfWeek + 6) % 7;
      const start = new Date(startOfToday);
      start.setDate(startOfToday.getDate() - diffToMonday + periodOffset * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      return { start, end };
    }

    if (selectedPeriod === "current_month") {
      const start = new Date(now.getFullYear(), now.getMonth() + periodOffset, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + periodOffset + 1, 1);
      return { start, end };
    }
    return { start: startOfToday, end: now };
  }, [periodOffset, selectedPeriod]);

  const periodHeading = useMemo(() => {
    if (selectedPeriod === "today") {
      if (periodOffset === 0) {
        return "Idag";
      }
      if (periodOffset === -1) {
        return "Igår";
      }
      return capitalizeFirstLetter(weekDayFormatter.format(periodRange.start));
    }

    if (selectedPeriod === "current_week") {
      if (periodOffset === 0) {
        return "Denna vecka";
      }
      if (periodOffset === -1) {
        return "Förra veckan";
      }
      return `Vecka ${getIsoWeekNumber(periodRange.start)}`;
    }

    if (periodOffset === 0) {
      return "Denna månad";
    }
    if (periodOffset === -1) {
      return "Förra månaden";
    }

    return capitalizeFirstLetter(monthLabelFormatter.format(periodRange.start));
  }, [periodOffset, periodRange.start, selectedPeriod]);

  const canStepForward = periodOffset < 0;

  const loadGenerationStats = useCallback(async () => {
    setLoadError("");
    setIsLoading(true);

    let logs: GenerationLogRow[];
    try {
      const params = new URLSearchParams({
        kind: "generated",
        from: periodRange.start.toISOString(),
        to: periodRange.end.toISOString(),
        limit: "500",
      });
      const { items } = await apiJson<{ items: GenerationLogRow[] }>(`/api/images?${params.toString()}`);
      logs = items;
    } catch (error) {
      const message = describeError(error, "Kunde inte hämta statistik.");
      if (message) {
        setLoadError(message);
      }
      setGenerationCount(0);
      setGenerationLogs([]);
      setIsLoading(false);
      return;
    }

    setGenerationLogs(logs);
    setGenerationCount(logs.length);
    setIsLoading(false);
  }, [periodRange.end, periodRange.start]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGenerationStats();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadGenerationStats]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!periodMenuRef.current) {
        return;
      }
      if (event.target instanceof Node && !periodMenuRef.current.contains(event.target)) {
        setIsPeriodMenuOpen(false);
      }
    }

    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!previewLog) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeImagePreview();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [previewLog]);

  function openImagePreview(log: GenerationLogRow) {
    setPreviewLog(log);
    setPreviewZoom(1);
    // The URL is known up front now; the image frame shows its own placeholder while it loads.
    setPreviewUrl(imageUrl(log.id, "full", log.version));
    setIsPreviewLoading(false);
  }

  function closeImagePreview() {
    setPreviewLog(null);
    setPreviewUrl(null);
    setPreviewZoom(1);
    setIsPreviewLoading(false);
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

  return (
    <Page>
      <PageHeader
        title="Fakturering"
        description={`Genereringar och kostnad per period. Varje färdig planritning kostar ${SEK_PER_GENERATION} kr.`}
        actions={
            <div className="w-full md:w-auto">
              <div
                ref={periodMenuRef}
                className="relative flex w-full flex-nowrap items-center justify-center gap-1 rounded-xl border border-stone-200 bg-white p-1 shadow-[0_1px_2px_rgba(28,25,23,0.05)] md:w-auto"
              >
              <button
                type="button"
                aria-label="Föregående period"
                onClick={() => setPeriodOffset((previous) => previous - 1)}
                className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isPeriodMenuOpen}
                aria-label="Välj period"
                onClick={() => setIsPeriodMenuOpen((previous) => !previous)}
                className="flex h-8 w-[150px] shrink-0 cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-medium text-stone-900 transition hover:bg-stone-100"
              >
                <span className="w-full truncate text-center">{periodHeading}</span>
              </button>
              <button
                type="button"
                aria-label="Nästa period"
                onClick={() => setPeriodOffset((previous) => Math.min(0, previous + 1))}
                disabled={!canStepForward}
                className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>

              {isPeriodMenuOpen ? (
                <div className="absolute right-0 z-20 mt-2 w-full rounded-lg border border-stone-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(28,25,23,0.18)]">
                  <ul role="listbox" aria-label="Periodval" className="space-y-1">
                    {periodOptions.map((period) => (
                      <li key={period}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selectedPeriod === period}
                          onClick={() => {
                            setSelectedPeriod(period);
                            setPeriodOffset(0);
                            setIsPeriodMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                            selectedPeriod === period
                              ? "bg-stone-100 text-stone-900"
                              : "text-stone-800 hover:bg-stone-50"
                          }`}
                        >
                          <span>{periodLabels[period]}</span>
                          {selectedPeriod === period ? (
                            <Check size={15} aria-hidden="true" className="text-stone-500" />
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              </div>
            </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
          <p className="text-sm text-stone-500">Planritningar</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-stone-900 tabular-nums">
            {isLoading ? <span className="inline-block h-8 w-12 animate-pulse rounded bg-stone-100 align-middle" /> : generationCount}
          </p>
          <p className="mt-1 text-xs text-stone-500">{periodHeading}</p>
        </article>

        <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
          <p className="text-sm text-stone-500">Kostnad</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-stone-900 tabular-nums">
            {isLoading ? (
              <span className="inline-block h-8 w-24 animate-pulse rounded bg-stone-100 align-middle" />
            ) : (
              `${new Intl.NumberFormat("sv-SE").format(totalCostSek)} kr`
            )}
          </p>
          <p className="mt-1 text-xs text-stone-500">{SEK_PER_GENERATION} kr per planritning</p>
        </article>
      </div>

      {loadError ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {loadError}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
          <div className="grid grid-cols-[1fr_auto_auto] gap-6 border-b border-stone-100 bg-stone-50/70 px-5 py-2.5 text-xs font-medium text-stone-500">
            <span>Planritning</span>
            <span>Skapad</span>
            <span className="w-14 text-right">Belopp</span>
          </div>

          {isLoading ? (
            <div className="divide-y divide-stone-100" aria-busy="true">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="flex items-center justify-between px-5 py-3.5">
                  <div className="h-3.5 w-20 animate-pulse rounded bg-stone-100" />
                  <div className="h-3 w-28 animate-pulse rounded bg-stone-100" />
                </div>
              ))}
            </div>
          ) : null}

          {!isLoading && generationLogs.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-stone-500">
              Inga planritningar skapades under perioden.
            </p>
          ) : null}

          {!isLoading && generationLogs.length > 0 ? (
            <div className="divide-y divide-stone-100">
              {generationLogs.map((log) => (
                <button
                  key={log.id}
                  type="button"
                  onClick={() => void openImagePreview(log)}
                  className="grid w-full cursor-zoom-in grid-cols-[1fr_auto_auto] items-center gap-6 px-5 py-3 text-left text-sm transition hover:bg-stone-50"
                >
                  <span className="truncate font-medium text-stone-900">{imageDisplayName(log.id)}</span>
                  <span className="text-xs text-stone-500 tabular-nums">{formatDateTime(log.created_at)}</span>
                  <span className="w-14 text-right text-sm text-stone-700 tabular-nums">
                    {SEK_PER_GENERATION} kr
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {previewLog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={closeImagePreview}
          role="presentation"
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Förhandsvisning av ${imageDisplayName(previewLog.id)}`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-100 bg-stone-50 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={zoomPreviewOut}
                  disabled={previewZoom <= MIN_PREVIEW_ZOOM || isPreviewLoading}
                  aria-label="Zooma ut"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Minus size={15} aria-hidden="true" />
                </button>
                <span className="w-14 shrink-0 text-center text-xs font-semibold text-stone-600">
                  {Math.round(previewZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={zoomPreviewIn}
                  disabled={previewZoom >= MAX_PREVIEW_ZOOM || isPreviewLoading}
                  aria-label="Zooma in"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={15} aria-hidden="true" />
                </button>
                <span className="truncate text-xs font-semibold text-stone-600">
                  {imageDisplayName(previewLog.id)}
                </span>
              </div>

              <button
                type="button"
                onClick={closeImagePreview}
                aria-label="Stäng bildvisning"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 transition hover:bg-stone-100"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="relative flex-1 overflow-auto bg-stone-100 p-4">
              <div className="mx-auto flex min-h-[50vh] w-full items-center justify-center">
                {isPreviewLoading || !previewUrl ? (
                  <Loader2 size={28} className="animate-spin text-stone-500" aria-hidden="true" />
                ) : (
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
                        src={previewUrl}
                        alt={imageDisplayName(previewLog.id)}
                        heightClassName="h-[50vh] sm:h-[calc(90vh-120px)]"
                        sizes="(max-width: 1024px) 95vw, 80vw"
                        priority
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}

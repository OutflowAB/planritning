"use client";

import { ThumbnailImage } from "@/components/ui/thumbnail-image";
import { Check, ChevronLeft, ChevronRight, Loader2, Minus, Plus, X } from "lucide-react";
import { TouchEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import { imageDisplayName } from "@/lib/image-naming";

const SEK_PER_GENERATION = 50;
const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const GENERATED_PREFIX = "generated/";
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

    const { data, error } = await supabase
      .from(UPLOADS_TABLE)
      .select("id, file_name, file_path, created_at")
      .like("file_path", `${GENERATED_PREFIX}%`)
      .gte("created_at", periodRange.start.toISOString())
      .lt("created_at", periodRange.end.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      setLoadError(`Kunde inte hämta statistik: ${error.message}`);
      setGenerationCount(0);
      setGenerationLogs([]);
      setIsLoading(false);
      return;
    }

    const logs = (data as GenerationLogRow[]) ?? [];
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

  async function openImagePreview(log: GenerationLogRow) {
    setPreviewLog(log);
    setPreviewZoom(1);
    setPreviewUrl(null);
    setIsPreviewLoading(true);

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(log.file_path, 3600);

    if (error || !data?.signedUrl) {
      setPreviewLog(null);
      setIsPreviewLoading(false);
      return;
    }

    setPreviewUrl(data.signedUrl);
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
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="rounded-none border border-[#d8d2c8] bg-white p-6 text-[#3d3a36] shadow-sm md:p-8">
        <div className="border-b border-[#e8e2d8] pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold text-[#3d3a36] md:text-3xl">
              Fakturaöversikt
            </h1>

            <div className="w-full md:w-auto">
              <div
                ref={periodMenuRef}
                className="relative flex w-full flex-nowrap items-center justify-center gap-1 rounded-md border border-[#d8d2c8] bg-[#f7f4ef] p-1 md:w-auto"
              >
              <button
                type="button"
                aria-label="Föregående period"
                onClick={() => setPeriodOffset((previous) => previous - 1)}
                className="flex h-10 w-12 shrink-0 items-center justify-center rounded-sm border border-[#d8d2c8] bg-transparent text-[#5b544a] transition hover:bg-white focus:outline-none"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isPeriodMenuOpen}
                aria-label="Välj period"
                onClick={() => setIsPeriodMenuOpen((previous) => !previous)}
                className="flex h-10 w-[150px] shrink-0 cursor-pointer items-center justify-center rounded-sm bg-transparent px-4 py-2 text-sm font-semibold text-[#3d3a36] outline-none transition"
              >
                <span className="w-full truncate text-center">{periodHeading}</span>
              </button>
              <button
                type="button"
                aria-label="Nästa period"
                onClick={() => setPeriodOffset((previous) => Math.min(0, previous + 1))}
                disabled={!canStepForward}
                className="flex h-10 w-12 shrink-0 items-center justify-center rounded-sm border border-[#d8d2c8] bg-transparent text-[#5b544a] transition hover:bg-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>

              {isPeriodMenuOpen ? (
                <div className="absolute right-0 z-20 mt-2 w-full rounded-none border border-[#d8d2c8] bg-white p-1 shadow-[0_8px_24px_rgba(61,48,40,0.15)]">
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
                          className={`flex w-full items-center justify-between rounded-none px-3 py-2 text-left text-sm font-medium transition ${
                            selectedPeriod === period
                              ? "bg-[#f2ede5] text-[#3d3a36]"
                              : "text-[#4d463f] hover:bg-[#f7f4ef]"
                          }`}
                        >
                          <span>{periodLabels[period]}</span>
                          {selectedPeriod === period ? (
                            <Check size={15} aria-hidden="true" className="text-[#7a6a60]" />
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              </div>
            </div>
          </div>
          <p className="mt-2 text-sm text-[#6a6258]">
            Översikt över genereringar och kostnad för vald period.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-none border border-[#d8d2c8] bg-[#f7f4ef] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#7b746a]">
              Antal genereringar
            </p>
            <p className="mt-3 text-3xl font-semibold text-[#3d3a36]">
              {isLoading ? "..." : generationCount}
            </p>
            <p className="mt-2 text-xs text-[#7b746a]">
              Summerat från vald period.
            </p>
          </article>

          <article className="rounded-none border border-[#d8d2c8] bg-[#f7f4ef] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#7b746a]">
              Kostnad
            </p>
            <p className="mt-3 text-3xl font-semibold text-[#3d3a36]">
              {isLoading ? "..." : `${totalCostSek} kr`}
            </p>
            <p className="mt-2 text-xs text-[#7b746a]">
              Baserat på {SEK_PER_GENERATION} kr per generering.
            </p>
          </article>
        </div>

        {loadError ? (
          <p className="mt-6 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        ) : null}
        </div>

        {!loadError ? (
          <div className="rounded-none border border-[#d8d2c8] bg-[#faf8f4] shadow-sm">
            {isLoading ? (
              <p className="px-4 py-3 text-sm text-[#6a6258]">Laddar logg...</p>
            ) : null}

            {!isLoading && generationLogs.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[#6a6258]">
                Inga genereringar i vald period.
              </p>
            ) : null}

            {!isLoading && generationLogs.length > 0 ? (
              <div className="divide-y divide-[#e8e2d8]">
                {generationLogs.map((log) => (
                  <button
                    key={log.id}
                    type="button"
                    onClick={() => void openImagePreview(log)}
                    className="flex w-full cursor-zoom-in items-center justify-between gap-3 px-4 py-3 text-left text-sm transition hover:bg-[#f2ede5]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[#3d3a36]">{imageDisplayName(log.id)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-[#7b746a]">
                        {new Date(log.created_at).toLocaleString("sv-SE")}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {previewLog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={closeImagePreview}
          role="presentation"
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-none border border-[#d8d2c8] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Förhandsvisning av ${imageDisplayName(previewLog.id)}`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={zoomPreviewOut}
                  disabled={previewZoom <= MIN_PREVIEW_ZOOM || isPreviewLoading}
                  aria-label="Zooma ut"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Minus size={15} aria-hidden="true" />
                </button>
                <span className="w-14 shrink-0 text-center text-xs font-semibold text-[#6a6258]">
                  {Math.round(previewZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={zoomPreviewIn}
                  disabled={previewZoom >= MAX_PREVIEW_ZOOM || isPreviewLoading}
                  aria-label="Zooma in"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={15} aria-hidden="true" />
                </button>
                <span className="truncate text-xs font-semibold text-[#6a6258]">
                  {imageDisplayName(previewLog.id)}
                </span>
              </div>

              <button
                type="button"
                onClick={closeImagePreview}
                aria-label="Stäng bildvisning"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5]"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="relative flex-1 overflow-auto bg-[#f0ece6] p-4">
              <div className="mx-auto flex min-h-[50vh] w-full items-center justify-center">
                {isPreviewLoading || !previewUrl ? (
                  <Loader2 size={28} className="animate-spin text-[#7b746a]" aria-hidden="true" />
                ) : (
                  <div
                    className="touch-none select-none"
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
    </section>
  );
}

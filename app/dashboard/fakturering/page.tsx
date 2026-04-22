"use client";

import Link from "next/link";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

const SEK_PER_GENERATION = 80;
const UPLOADS_TABLE = "uploaded_images";
const GENERATED_PREFIX = "generated/";

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
  const periodMenuRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="w-full max-w-5xl rounded-none border border-[#d8d2c8] bg-white p-6 text-[#3d3a36] shadow-sm md:p-8">
        <div className="border-b border-[#e8e2d8] pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold text-[#3d3a36] md:text-3xl">
              Fakturaöversikt
            </h1>

            <div className="w-full md:w-auto">
              <div
                ref={periodMenuRef}
                className="relative flex w-full flex-nowrap items-center justify-center gap-1 rounded-none border border-[#d8d2c8] bg-[#f7f4ef] p-1 md:w-auto"
              >
              <button
                type="button"
                aria-label="Föregående period"
                onClick={() => setPeriodOffset((previous) => previous - 1)}
                className="flex h-10 w-12 shrink-0 items-center justify-center rounded-none border border-[#d8d2c8] bg-transparent text-[#5b544a] transition hover:bg-white focus:outline-none"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isPeriodMenuOpen}
                aria-label="Välj period"
                onClick={() => setIsPeriodMenuOpen((previous) => !previous)}
                className="flex h-10 w-[150px] shrink-0 cursor-pointer items-center justify-center rounded-none bg-transparent px-4 py-2 text-sm font-semibold text-[#3d3a36] outline-none transition"
              >
                <span className="w-full truncate text-center">{periodHeading}</span>
              </button>
              <button
                type="button"
                aria-label="Nästa period"
                onClick={() => setPeriodOffset((previous) => Math.min(0, previous + 1))}
                disabled={!canStepForward}
                className="flex h-10 w-12 shrink-0 items-center justify-center rounded-none border border-[#d8d2c8] bg-transparent text-[#5b544a] transition hover:bg-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
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

        <div className="mt-6 rounded-none border border-[#d8d2c8] bg-[#faf8f4]">
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
                <Link
                  key={log.id}
                  href={`/dashboard/bibliotek?imageId=${log.id}&imagePath=${encodeURIComponent(log.file_path)}&previewImageId=${log.id}&previewImagePath=${encodeURIComponent(log.file_path)}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition hover:bg-[#f2ede5]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[#3d3a36]">{log.file_name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-[#7b746a]">
                      {new Date(log.created_at).toLocaleString("sv-SE")}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        {loadError ? (
          <p className="mt-6 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        ) : null}
      </div>
    </section>
  );
}

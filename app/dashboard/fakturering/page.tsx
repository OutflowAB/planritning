"use client";

import {
  CalendarRange,
  CircleDollarSign,
  CreditCard,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";

const SEK_PER_GENERATION = 80;
const GENERATIONS_TABLE = "generation_events";

type PeriodKey = "last_30_days" | "current_month";

const periodLabels: Record<PeriodKey, string> = {
  last_30_days: "Senaste 30 dagar",
  current_month: "Denna månad",
};

export default function FaktureringPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>("last_30_days");
  const [generationCount, setGenerationCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const totalCostSek = generationCount * SEK_PER_GENERATION;

  const periodRange = useMemo(() => {
    const now = new Date();

    if (selectedPeriod === "current_month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start, end };
    }

    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { start, end: now };
  }, [selectedPeriod]);

  const loadGenerationStats = useCallback(async () => {
    setLoadError("");
    setIsLoading(true);

    const { count, error } = await supabase
      .from(GENERATIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .gte("created_at", periodRange.start.toISOString())
      .lt("created_at", periodRange.end.toISOString());

    if (error) {
      setLoadError(`Kunde inte hämta statistik: ${error.message}`);
      setGenerationCount(0);
      setIsLoading(false);
      return;
    }

    setGenerationCount(count ?? 0);
    setIsLoading(false);
  }, [periodRange.end, periodRange.start]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGenerationStats();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadGenerationStats]);

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 shadow-sm md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <CreditCard size={14} aria-hidden="true" />
              Fakturering
            </div>
            <h1 className="text-2xl font-semibold text-slate-900 md:text-3xl">
              Fakturaöversikt
            </h1>
            <p className="text-sm text-slate-500">
              Översikt över genereringar och kostnad för vald period.
            </p>
          </div>

          <div className="w-full max-w-xs rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label
              htmlFor="billing-period"
              className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600"
            >
              <CalendarRange size={14} aria-hidden="true" />
              Period
            </label>
            <select
              id="billing-period"
              value={selectedPeriod}
              onChange={(event) => setSelectedPeriod(event.target.value as PeriodKey)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-slate-400"
            >
              <option value="last_30_days">{periodLabels.last_30_days}</option>
              <option value="current_month">{periodLabels.current_month}</option>
            </select>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Antal genereringar
            </p>
            <p className="mt-3 text-3xl font-semibold text-slate-900">
              {isLoading ? "..." : generationCount}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Summerat från vald period.
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Kostnad
            </p>
            <p className="mt-3 inline-flex items-center gap-2 text-3xl font-semibold text-slate-900">
              <CircleDollarSign size={24} aria-hidden="true" />
              {isLoading ? "..." : `${totalCostSek} kr`}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Baserat på {SEK_PER_GENERATION} kr per generering.
            </p>
          </article>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="inline-flex items-center gap-2">
            <Sparkles size={16} aria-hidden="true" className="text-slate-500" />
            Betalstatus kommer att avgöras från databasen i nästa steg.
          </p>
          {loadError ? (
            <p className="mt-2 text-red-600">{loadError}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

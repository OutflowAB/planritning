"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiJson, describeError, isAbortError } from "@/lib/api-client";
import type { DevUsage } from "@/lib/dev-usage";

const kr = (value: number) => `${value.toLocaleString("sv-SE", { maximumFractionDigits: 2 })} kr`;
const number = (value: number) => value.toLocaleString("sv-SE");

function monthLabel(key: string) {
  return new Date(`${key}-01T12:00:00Z`).toLocaleDateString("sv-SE", { month: "long", year: "numeric", timeZone: "UTC" });
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <article className="rounded-none border border-[#d8d2c8] bg-[#f7f4ef] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#7b746a]">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-[#3d3a36]">{value}</p>
      {note ? <p className="mt-2 text-xs text-[#7b746a]">{note}</p> : null}
    </article>
  );
}

const cell = "px-3 py-2 text-right tabular-nums";
const head = "px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[#7b746a]";

export default function DevUsagePage() {
  const [usage, setUsage] = useState<DevUsage | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const fetchUsage = useCallback(async (signal?: AbortSignal) => {
    try {
      setUsage(await apiJson<DevUsage>("/api/dev/usage", { signal }));
      setError("");
    } catch (caught) {
      if (!isAbortError(caught)) setError(describeError(caught, "Kunde inte hämta användningen.") ?? "");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Deferred, like the other lists, so state is never set while the page is rendering.
    const timer = window.setTimeout(() => void fetchUsage(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [fetchUsage]);

  function refresh() {
    setIsLoading(true);
    void fetchUsage();
  }

  if (!usage) {
    return error ? (
      <p className="text-sm text-red-700">{error}</p>
    ) : (
      <p className="inline-flex items-center gap-2 text-sm text-[#6a6258]" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Hämtar användning...
      </p>
    );
  }

  const [current, ...earlier] = usage.months;
  const { settings, totals } = usage;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold capitalize text-[#3d3a36]">{monthLabel(current.month)}</h1>
        <button
          type="button"
          onClick={refresh}
          disabled={isLoading}
          className="rounded-none border border-[#d8d2c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:opacity-60"
        >
          {isLoading ? "Hämtar..." : "Uppdatera"}
        </button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card label="Fakturerat" value={kr(current.billedSek)} note={`${number(current.plans)} slutförda planer à ${kr(settings.planPriceSek)}`} />
        <Card label="AI-omgörningar" value={number(current.generations)} note={`av ${number(settings.aiMonthlyCap)} i kvot`} />
        <Card label="AI-kostnad (uppskattad)" value={kr(current.aiCostSek)} note={`${kr(settings.aiCostPerGenerationSek)} per omgörning`} />
        <Card label="Marginal" value={kr(current.marginSek)} note="fakturerat minus uppskattad AI-kostnad" />
        <Card label="Lagring" value={`${number(totals.storageMb)} MB`} note={`${number(totals.images)} bilder, ${number(totals.realtors)} mäklare`} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#7b746a]">Mäklare, den här månaden</h2>
        <div className="overflow-x-auto border border-[#d8d2c8] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#f7f4ef]">
              <tr>
                <th className={`${head} text-left`}>Mäklare</th>
                <th className={head}>Planer</th>
                <th className={head}>Fakturerat</th>
                <th className={head}>AI</th>
                <th className={head}>AI-kostnad</th>
                <th className={head}>Bilder</th>
                <th className={head}>Lagring</th>
              </tr>
            </thead>
            <tbody>
              {usage.realtors.map((realtor) => (
                <tr key={realtor.userId} className="border-t border-[#e8e2d8]">
                  <td className="px-3 py-2 text-[#3d3a36]">{realtor.displayName}</td>
                  <td className={cell}>{number(realtor.plans)}</td>
                  <td className={cell}>{kr(realtor.billedSek)}</td>
                  <td className={cell}>{number(realtor.generations)}</td>
                  <td className={cell}>{kr(realtor.aiCostSek)}</td>
                  <td className={cell}>{number(realtor.images)}</td>
                  <td className={cell}>{number(realtor.storageMb)} MB</td>
                </tr>
              ))}
              {usage.realtors.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-[#7b746a]" colSpan={7}>Inga mäklare ännu.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#7b746a]">Tidigare månader</h2>
        <div className="overflow-x-auto border border-[#d8d2c8] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#f7f4ef]">
              <tr>
                <th className={`${head} text-left`}>Månad</th>
                <th className={head}>Planer</th>
                <th className={head}>Fakturerat</th>
                <th className={head}>AI</th>
                <th className={head}>AI-kostnad</th>
                <th className={head}>Marginal</th>
              </tr>
            </thead>
            <tbody>
              {earlier.map((month) => (
                <tr key={month.month} className="border-t border-[#e8e2d8]">
                  <td className="px-3 py-2 capitalize text-[#3d3a36]">{monthLabel(month.month)}</td>
                  <td className={cell}>{number(month.plans)}</td>
                  <td className={cell}>{kr(month.billedSek)}</td>
                  <td className={cell}>{number(month.generations)}</td>
                  <td className={cell}>{kr(month.aiCostSek)}</td>
                  <td className={cell}>{kr(month.marginSek)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-[#7b746a]">
        Fakturerat är det som debiterats mäklarna per slutförd plan. AI-kostnaden är en uppskattning
        (AI_COST_PER_GENERATION_SEK), inte OpenAI:s faktura. Här syns bara antal och summor, aldrig planer,
        adresser eller bilder.
      </p>
    </div>
  );
}

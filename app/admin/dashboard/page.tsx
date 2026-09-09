"use client";

import { useEffect, useMemo, useState } from "react";

import { apiJson, describeError, isAbortError } from "@/lib/api-client";

const IMAGE_GENERATION_COST_SEK = 50;

type StatCardProps = {
  label: string;
  value: string;
  helpText: string;
};

function StatCard({ label, value, helpText }: StatCardProps) {
  return (
    <article className="rounded-none border border-[#d8d2c8] bg-[#f7f4ef] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#7b746a]">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-[#3d3a36]">{value}</p>
      <p className="mt-2 text-xs text-[#7b746a]">{helpText}</p>
    </article>
  );
}

type Counts = { generated: number; uploads: number };

async function fetchCounts(signal: AbortSignal): Promise<Counts> {
  // Independent counts, fetched together.
  const [generated, uploads] = await Promise.all([
    apiJson<{ count: number }>("/api/images?kind=generated&count=1", { signal }),
    apiJson<{ count: number }>("/api/images?kind=uploads&count=1", { signal }),
  ]);
  return { generated: generated.count, uploads: uploads.count };
}

export default function AdminDashboardPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loadError, setLoadError] = useState("");

  const estimatedCost = useMemo(
    () => (counts?.generated ?? 0) * IMAGE_GENERATION_COST_SEK,
    [counts],
  );

  useEffect(() => {
    const controller = new AbortController();

    fetchCounts(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setCounts(next);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }
        setLoadError(describeError(error, "Kunde inte hämta dashboard-data just nu.") ?? "");
      });

    return () => controller.abort();
  }, []);

  const isLoading = counts === null && !loadError;

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="rounded-none border border-[#d8d2c8] bg-white p-4 text-[#3d3a36] shadow-sm sm:p-6 md:p-8">
          <h1 className="text-2xl font-semibold md:text-3xl">Dashboard</h1>
          <p className="mt-2 text-sm text-[#6a6258]">
            Snabb översikt av uppladdningar, genereringar och estimerad kostnad.
          </p>
        </div>

        {loadError ? (
          <p className="rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          <StatCard
            label="Genererade bilder"
            value={isLoading ? "–" : String(counts?.generated ?? 0)}
            helpText="Antal bilder i mappen generated/."
          />
          <StatCard
            label="Uppladdade original"
            value={isLoading ? "–" : String(counts?.uploads ?? 0)}
            helpText="Antal bilder i mappen uploads/."
          />
          <StatCard
            label="Estimerad kostnad"
            value={isLoading ? "–" : `${estimatedCost} kr`}
            helpText={`Beräknat med ${IMAGE_GENERATION_COST_SEK} kr per generering.`}
          />
        </div>
      </div>
    </section>
  );
}

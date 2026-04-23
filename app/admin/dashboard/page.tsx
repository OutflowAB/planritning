"use client";

import { useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";

const IMAGE_GENERATION_COST_SEK = 80;
const GENERATED_UPLOADS_PREFIX = "generated/";

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

export default function AdminDashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [generatedCount, setGeneratedCount] = useState(0);
  const [uploadCount, setUploadCount] = useState(0);

  const estimatedCost = useMemo(
    () => generatedCount * IMAGE_GENERATION_COST_SEK,
    [generatedCount],
  );

  useEffect(() => {
    let active = true;

    async function loadDashboardData() {
      setLoadError("");
      setIsLoading(true);

      const [generatedResult, uploadsResult] = await Promise.all([
        supabase
          .from("uploaded_images")
          .select("id", { count: "exact", head: true })
          .like("file_path", `${GENERATED_UPLOADS_PREFIX}%`),
        supabase
          .from("uploaded_images")
          .select("id", { count: "exact", head: true })
          .like("file_path", "uploads/%"),
      ]);

      if (!active) {
        return;
      }

      if (generatedResult.error || uploadsResult.error) {
        setLoadError("Kunde inte hämta dashboard-data just nu.");
        setIsLoading(false);
        return;
      }

      setGeneratedCount(generatedResult.count ?? 0);
      setUploadCount(uploadsResult.count ?? 0);
      setIsLoading(false);
    }

    void loadDashboardData();

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="rounded-none border border-[#d8d2c8] bg-white p-6 text-[#3d3a36] shadow-sm md:p-8">
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

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Genererade bilder"
            value={isLoading ? "..." : String(generatedCount)}
            helpText="Antal bilder i mappen generated/."
          />
          <StatCard
            label="Uppladdade original"
            value={isLoading ? "..." : String(uploadCount)}
            helpText="Antal bilder i mappen uploads/."
          />
          <StatCard
            label="Estimerad kostnad"
            value={isLoading ? "..." : `${estimatedCost} kr`}
            helpText={`Beräknat med ${IMAGE_GENERATION_COST_SEK} kr per generering.`}
          />
        </div>
      </div>
    </section>
  );
}

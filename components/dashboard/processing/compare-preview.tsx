"use client";

import { useEffect, useState } from "react";

import { ImageCompareSlider } from "@/components/dashboard/image-compare-slider";
import type { ImageListItem } from "@/app/api/images/route";
import { imageDisplayName } from "@/lib/image-naming";
import { imageUrl } from "@/lib/image-url";

/** The drawing area of a finished sheet, roughly; the real flow uses the exact layout. */
const APPROXIMATE_SHEET_SLOT = { x: 0.06, y: 0.1, width: 0.88, height: 0.78 };
const WHOLE_IMAGE = { x: 0, y: 0, width: 1, height: 1 };

/**
 * Development only: the compare slider on plans already in the library, with the original
 * lined up (or not), so the alignment can be judged without generating anything.
 */
export function ComparePreview() {
  const [plans, setPlans] = useState<ImageListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [align, setAlign] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // Plain fetch, not apiJson: that sends a signed-out visitor to the login page, and this
    // preview page should stay put and just say so.
    fetch("/api/images?kind=generated&saved=1", { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{ items: ImageListItem[] }>;
      })
      .then(({ items }) => {
        const withOriginal = items.filter((item) => item.source_upload_id);
        setPlans(withOriginal);
        setSelectedId(withOriginal[0]?.id ?? null);
      })
      .catch(() => setError("Logga in i appen först, så kan planritningarna hämtas."));
  }, []);

  const selected = plans?.find((plan) => plan.id === selectedId) ?? null;

  return (
    <div className="w-full rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_16px_40px_-24px_rgba(28,25,23,0.16)] sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={selectedId ?? ""}
          onChange={(event) => setSelectedId(Number(event.target.value))}
          disabled={!plans?.length}
          className="h-9 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900"
        >
          {(plans ?? []).map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.label ?? imageDisplayName(plan.id)} (original {imageDisplayName(plan.source_upload_id!)})
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={align}
            onChange={(event) => setAlign(event.target.checked)}
            className="h-4 w-4 accent-[var(--tenant-accent)]"
          />
          Passa in originalet
        </label>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {plans && plans.length === 0 ? (
        <p className="text-sm text-stone-500">Inga sparade planritningar med original att jämföra.</p>
      ) : null}
      {selected ? (
        <ImageCompareSlider
          key={selected.id}
          beforeSrc={imageUrl(selected.source_upload_id!, "full", null)}
          afterSrc={imageUrl(selected.id, "full", selected.version)}
          alignRegion={align ? APPROXIMATE_SHEET_SLOT : null}
          beforeAlignRegion={WHOLE_IMAGE}
        />
      ) : null}
    </div>
  );
}

"use client";

import { Check } from "lucide-react";
import { useState, type ReactNode } from "react";

import { floorLabel } from "@/lib/floor-groups";
import { storeyProgressText } from "@/lib/storey-floors";

export type StoreyOption = { story: number; roomCount: number; areaM2: number };

export const storeyLabel = floorLabel;

type StoreyPickerProps = {
  storeys: StoreyOption[];
  onConfirm: (stories: number[]) => void;
  onCancel: () => void;
  /** The compass control, shown above the buttons so it is settled before anything is billed. */
  compass?: ReactNode;
};

/** Shown before any image is generated, so only the floors the user wants are billed. */
export function StoreyPicker({ storeys, onConfirm, onCancel, compass }: StoreyPickerProps) {
  const single = storeys.length === 1;
  const [selected, setSelected] = useState<number[]>(() => storeys.map((s) => s.story));
  const allSelected = selected.length === storeys.length;

  function toggle(story: number) {
    setSelected((previous) =>
      previous.includes(story) ? previous.filter((s) => s !== story) : [...previous, story],
    );
  }

  return (
    <div className="space-y-3 border border-stone-200 bg-stone-50 p-4">
      <p className="text-sm font-medium text-stone-700">
        {single
          ? "Skanningen är läst. Kontrollera kompassen innan planen ritas."
          : `Skanningen har ${storeys.length} våningar. Vilka vill du rita?`}
      </p>
      {single ? null : (
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-stone-800">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => setSelected(allSelected ? [] : storeys.map((s) => s.story))}
          className="h-4 w-4 accent-stone-700"
        />
        Alla våningar
      </label>
      )}
      <ul className={single ? "hidden" : "space-y-1.5"}>
        {storeys.map((storey, index) => (
          <li key={storey.story}>
            <label className="flex cursor-pointer items-center gap-2 border border-stone-100 bg-white px-3 py-2 text-sm text-stone-800">
              <input
                type="checkbox"
                checked={selected.includes(storey.story)}
                onChange={() => toggle(storey.story)}
                className="h-4 w-4 accent-stone-700"
              />
              <span className="font-medium">{storeyLabel(index, storeys.length)}</span>
              <span className="text-xs text-stone-500">
                {storey.roomCount} rum, ca {storey.areaM2} m²
              </span>
            </label>
          </li>
        ))}
      </ul>
      {compass}
      {single ? null : (
        <p className="text-xs text-stone-500">Varje vald våning är en egen konvertering.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
        >
          Avbryt
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => onConfirm(storeys.map((s) => s.story).filter((s) => selected.includes(s)))}
          className="inline-flex min-w-[157px] items-center justify-center rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {single
            ? "Konvertera"
            : `Konvertera ${selected.length === 1 ? "1 våning" : `${selected.length} våningar`}`}
        </button>
      </div>
    </div>
  );
}

type StoreyProgressProps = { labels: string[]; done: number };

/** One node per chosen floor: ticked when finished, pulsing while it is being drawn. */
export function StoreyProgress({ labels, done }: StoreyProgressProps) {
  return (
    <div className="mx-auto w-full max-w-xl space-y-3 px-4 pb-6" aria-live="polite">
      <ol className="flex items-start">
        {labels.map((label, index) => {
          const finished = index < done;
          const current = index === done;
          return (
            <li key={label} className="relative flex flex-1 flex-col items-center gap-1.5">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={`absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2 ${
                    index <= done ? "bg-primary" : "bg-stone-200"
                  }`}
                />
              ) : null}
              <span
                className={`relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
                  finished
                    ? "border-primary bg-primary text-white"
                    : current
                      ? "animate-pulse border-primary bg-white text-stone-700"
                      : "border-stone-200 bg-white text-stone-400"
                }`}
              >
                {finished ? <Check size={14} aria-hidden="true" /> : index + 1}
              </span>
              <span className="text-center text-[11px] leading-tight text-stone-600">{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-center text-sm font-medium text-stone-700">
        {storeyProgressText(done, labels.length)}
      </p>
    </div>
  );
}

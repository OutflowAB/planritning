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
    <div className="space-y-3 border border-[#d8d2c8] bg-[#f7f4ef] p-4">
      <p className="text-sm font-medium text-[#5c544a]">
        {single
          ? "Skanningen är läst. Kontrollera kompassen innan planen ritas."
          : `Skanningen har ${storeys.length} våningar. Vilka vill du rita?`}
      </p>
      {single ? null : (
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#4d463f]">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => setSelected(allSelected ? [] : storeys.map((s) => s.story))}
          className="h-4 w-4 accent-[#5c544a]"
        />
        Alla våningar
      </label>
      )}
      <ul className={single ? "hidden" : "space-y-1.5"}>
        {storeys.map((storey, index) => (
          <li key={storey.story}>
            <label className="flex cursor-pointer items-center gap-2 border border-[#e8e2d8] bg-white px-3 py-2 text-sm text-[#4d463f]">
              <input
                type="checkbox"
                checked={selected.includes(storey.story)}
                onChange={() => toggle(storey.story)}
                className="h-4 w-4 accent-[#5c544a]"
              />
              <span className="font-medium">{storeyLabel(index, storeys.length)}</span>
              <span className="text-xs text-[#7b746a]">
                {storey.roomCount} rum, ca {storey.areaM2} m²
              </span>
            </label>
          </li>
        ))}
      </ul>
      {compass}
      {single ? null : (
        <p className="text-xs text-[#7b746a]">Varje vald våning är en egen konvertering.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
        >
          Avbryt
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => onConfirm(storeys.map((s) => s.story).filter((s) => selected.includes(s)))}
          className="inline-flex min-w-[157px] items-center justify-center rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
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
                    index <= done ? "bg-[#5c544a]" : "bg-[#d8d2c8]"
                  }`}
                />
              ) : null}
              <span
                className={`relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
                  finished
                    ? "border-[#5c544a] bg-[#5c544a] text-white"
                    : current
                      ? "animate-pulse border-[#5c544a] bg-white text-[#5c544a]"
                      : "border-[#d8d2c8] bg-white text-[#9a9288]"
                }`}
              >
                {finished ? <Check size={14} aria-hidden="true" /> : index + 1}
              </span>
              <span className="text-center text-[11px] leading-tight text-[#6a6258]">{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-center text-sm font-medium text-[#5c544a]">
        {storeyProgressText(done, labels.length)}
      </p>
    </div>
  );
}

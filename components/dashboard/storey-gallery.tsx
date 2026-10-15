"use client";

import { Check, Maximize2, RotateCcw } from "lucide-react";

import { imageUrl } from "@/lib/image-url";
import { savedImageVersion, type StoreyFloor } from "@/lib/storey-floors";

type StoreyGalleryProps = {
  floors: StoreyFloor[];
  activeIndex: number | null;
  disabled: boolean;
  onSelect: (index: number) => void;
  onEnlarge: (index: number) => void;
  onApproveAll: () => void;
};

/**
 * Every drawn floor side by side, so the broker can look at all of them before deciding.
 * Clicking a card puts that floor in the review card below; the corner button opens it large.
 */
export function StoreyGallery({
  floors,
  activeIndex,
  disabled,
  onSelect,
  onEnlarge,
  onApproveAll,
}: StoreyGalleryProps) {
  const pendingCount = floors.filter((floor) => floor.status !== "approved").length;

  return (
    <section
      aria-label="Alla våningar"
      className="mx-auto w-full max-w-3xl space-y-3 border border-[#d8d2c8] bg-[#f7f4ef] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#7b746a]">
          Våningar ({floors.length - pendingCount} av {floors.length} godkända)
        </p>
        {pendingCount > 1 ? (
          <button
            type="button"
            onClick={onApproveAll}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Godkänn alla ({pendingCount})
            <Check size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {floors.map((floor, index) => {
          const active = index === activeIndex;
          return (
            <li key={`${floor.label}-${floor.conversion.savedImageId}`} className="relative">
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-pressed={active}
                className={`block w-full border bg-white p-1.5 text-left transition ${
                  active ? "border-[#5c544a] ring-1 ring-[#5c544a]" : "border-[#d8d2c8] hover:border-[#b8aea0]"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(floor.conversion.savedImageId, "thumb", savedImageVersion(floor.conversion.savedImageUrl))}
                  alt={floor.label}
                  className="aspect-[1/1.414] w-full bg-[#f2ede5] object-contain"
                />
                <span className="mt-1.5 flex items-center justify-between gap-1 text-xs font-semibold text-[#4d463f]">
                  <span>{floor.label}</span>
                  {floor.status === "approved" ? (
                    <span className="inline-flex items-center gap-0.5 text-[#3f6b3f]">
                      <Check size={12} aria-hidden="true" />
                      Godkänd
                    </span>
                  ) : floor.status === "redone" ? (
                    <span className="inline-flex items-center gap-0.5 text-[#8a6a2a]">
                      <RotateCcw size={11} aria-hidden="true" />
                      Ny version
                    </span>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onEnlarge(index)}
                aria-label={`Förstora ${floor.label}`}
                className="absolute right-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center border border-[#d8d2c8] bg-white/90 text-[#4d463f] transition hover:bg-white"
              >
                <Maximize2 size={13} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

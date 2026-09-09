"use client";

import type { CSSProperties } from "react";

export const WATERMARK_SRC = "/vattenmarke.svg";

/** The mark's own proportions, from public/vattenmarke.svg (992.05 × 1136.20). */
const WATERMARK_ASPECT = 1136.2 / 992.05;
const WATERMARK_WIDTH_PX = 104;
const WATERMARK_HEIGHT_PX = Math.round(WATERMARK_WIDTH_PX * WATERMARK_ASPECT);

/**
 * The meerkat only occupies the left 66% of its own viewBox — measured at 69 of 104px, with
 * the rest empty. Clipping that dead column makes the gap below the actual distance between
 * marks instead of 35px more than it says.
 */
const WATERMARK_VISIBLE_WIDTH_PX = 69;

/** Distance between marks, edge to edge. */
const GAP_X_PX = 26;
const GAP_Y_PX = 26;

/**
 * Enough to cover the overlay. Extra marks are clipped by the parent's overflow rather than
 * measured, which keeps this a pure render with no layout observation.
 */
const COLUMNS = 20;
const ROWS = 10;

let watermarkPreloaded = false;

export function warmWatermarkImage() {
  if (typeof window === "undefined" || watermarkPreloaded) {
    return;
  }

  watermarkPreloaded = true;
  const image = new window.Image();
  image.src = WATERMARK_SRC;
}

if (typeof window !== "undefined") {
  warmWatermarkImage();
}

type WatermarkOverlayProps = {
  className?: string;
  style?: CSSProperties;
};

/**
 * Tiled watermark, upright, with every other row shifted half a step sideways.
 *
 * The marks are real elements rather than a repeating background, because `background-size`
 * sets the tile box and the image fills it — the gap between marks cannot be controlled
 * separately from their size. Rendering them makes spacing, orientation and the row offset
 * explicit.
 */
export function WatermarkOverlay({ className = "", style }: WatermarkOverlayProps) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-[5] overflow-hidden ${className}`}
      style={style}
      aria-hidden="true"
    >
      {/* No rotation any more, so the pattern only has to cover the element itself. */}
      <div className="absolute inset-0 opacity-30 mix-blend-screen">
        {Array.from({ length: ROWS }, (_, rowIndex) => (
          <div
            key={rowIndex}
            className="flex"
            style={{
              gap: `${GAP_X_PX}px`,
              marginTop: rowIndex === 0 ? 0 : `${GAP_Y_PX}px`,
              // Every second row starts half a step in, so the columns never line up.
              marginLeft:
                rowIndex % 2 === 1 ? `${(GAP_X_PX + WATERMARK_VISIBLE_WIDTH_PX) / 2}px` : 0,
            }}
          >
            {Array.from({ length: COLUMNS }, (_, columnIndex) => (
              <span
                key={columnIndex}
                className="block shrink-0 overflow-hidden"
                style={{ width: `${WATERMARK_VISIBLE_WIDTH_PX}px`, height: `${WATERMARK_HEIGHT_PX}px` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={WATERMARK_SRC}
                  alt=""
                  width={WATERMARK_WIDTH_PX}
                  height={WATERMARK_HEIGHT_PX}
                  className="max-w-none"
                />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function preventImageContextMenu(event: { preventDefault: () => void }) {
  event.preventDefault();
}

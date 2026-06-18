"use client";

import type { CSSProperties } from "react";

export const WATERMARK_SRC = "/vattenmarke.png";
const WATERMARK_TILE_PX = 100;

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

export function WatermarkOverlay({ className = "", style }: WatermarkOverlayProps) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-[5] overflow-hidden ${className}`}
      style={style}
      aria-hidden="true"
    >
      <div
        className="absolute -inset-1/4 opacity-30 mix-blend-screen"
        style={{
          backgroundImage: `url(${WATERMARK_SRC})`,
          backgroundRepeat: "repeat",
          backgroundSize: `${WATERMARK_TILE_PX}px ${WATERMARK_TILE_PX}px`,
          transform: "rotate(-22deg)",
        }}
      />
    </div>
  );
}

export function preventImageContextMenu(event: { preventDefault: () => void }) {
  event.preventDefault();
}

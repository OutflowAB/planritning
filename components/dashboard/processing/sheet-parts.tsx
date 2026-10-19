import { CSSProperties, ReactNode } from "react";

import { TENANT } from "@/lib/brand";

/**
 * The made-up house every processing animation draws, and the parts of the finished sheet
 * around it. Coordinates are in the sheet's own units: an A4 page, 210 × 297.
 *
 * Decorative only. None of this is the customer's plan; it stands in for "a plan is being
 * drawn" while the server works.
 */

export const SHEET_WIDTH = 210;
export const SHEET_HEIGHT = 297;

export const INK = "#1c1917";
export const PAPER = "#fbfaf8";
export const BEIGE = "#e1d4c8";

export type Segment = { x1: number; y1: number; x2: number; y2: number };

export const OUTER_WALL = "M30 100 H180 V220 H30 Z";

/** Every wall as a centre line and its thickness; doors are the gaps between them. */
export const WALLS: (Segment & { width: number })[] = [
  { x1: 30, y1: 100, x2: 180, y2: 100, width: 4.2 },
  { x1: 180, y1: 100, x2: 180, y2: 220, width: 4.2 },
  { x1: 180, y1: 220, x2: 30, y2: 220, width: 4.2 },
  { x1: 30, y1: 220, x2: 30, y2: 100, width: 4.2 },
  { x1: 110, y1: 100, x2: 110, y2: 148, width: 2.6 },
  { x1: 110, y1: 164, x2: 110, y2: 172, width: 2.6 },
  { x1: 30, y1: 172, x2: 78, y2: 172, width: 2.6 },
  { x1: 100, y1: 172, x2: 180, y2: 172, width: 2.6 },
  { x1: 148, y1: 172, x2: 148, y2: 220, width: 2.6 },
];

export const WINDOWS: Segment[] = [
  { x1: 50, y1: 100, x2: 82, y2: 100 },
  { x1: 128, y1: 100, x2: 162, y2: 100 },
  { x1: 180, y1: 184, x2: 180, y2: 208 },
  { x1: 30, y1: 120, x2: 30, y2: 152 },
];

export const DOORS = [
  "M78 172 V150 A22 22 0 0 1 100 172",
  "M110 148 H124 A16 16 0 0 1 110 164",
  "M148 188 H162 A14 14 0 0 0 148 174",
];

export const FIXTURES = [
  "M115 105 H176 V117 H115 Z",
  "M121 108 H134 V114 H121 Z",
  "M153 192 H176 V216 H153 Z",
  "M36 177 H68 V215 H36 Z",
  "M36 184.6 H68 M36 192.2 H68 M36 199.8 H68 M36 207.4 H68",
];
export const STOVE = { cx: 156, cy: 111, r: 3.6 };

/** Rooms, for floors in the 3D model. */
export const ROOMS: { x: number; y: number; w: number; h: number }[] = [
  { x: 30, y: 100, w: 80, h: 72 },
  { x: 110, y: 100, w: 70, h: 72 },
  { x: 30, y: 172, w: 118, h: 48 },
  { x: 148, y: 172, w: 32, h: 48 },
];

export const LABELS = [
  { text: "VARDAGSRUM", x: 70, y: 140 },
  { text: "KÖK", x: 145, y: 142 },
  { text: "SOVRUM", x: 108, y: 199 },
  { text: "BAD", x: 164, y: 186 },
];

export const FONT = "var(--font-geist), system-ui, sans-serif";

/** Per-element start time (and optionally duration) for the CSS timelines below. */
export function at(seconds: number, duration?: number): CSSProperties {
  return {
    "--t": `${seconds}s`,
    ...(duration ? { "--d": `${duration}s` } : {}),
  } as CSSProperties;
}

/**
 * Shared keyframes. Every timed element runs once per mount (`both` fill), and the owner
 * remounts its <svg> each loop, so timelines always restart from zero.
 */
export const SHEET_KEYFRAMES = `
  /* Hidden until it starts: a zero-length dash with round caps would otherwise show as a dot. */
  @keyframes sp-draw  { 0% { stroke-dashoffset: 1; opacity: 0; } 1% { opacity: 1; } 100% { stroke-dashoffset: 0; opacity: 1; } }
  @keyframes sp-in    { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
  @keyframes sp-pop   { from { opacity: 0; transform: scale(0.5) rotate(-140deg); } to { opacity: 1; transform: none; } }
  @keyframes sp-mark  { 0% { opacity: 0; transform: scale(1.8); } 40% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1); } }
  @keyframes sp-wash  { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes sp-sweep { from { transform: translateX(-80px) skewX(-18deg); } to { transform: translateX(300px) skewX(-18deg); } }
  @keyframes sp-out   { to { opacity: 0; } }
  @keyframes sp-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
  @keyframes sp-shadow { 0%, 100% { transform: scaleX(1); opacity: 0.5; } 50% { transform: scaleX(0.9); opacity: 0.35; } }

  .sp-stage svg * { transform-box: fill-box; }
  .sp-float  { animation: sp-float 6s ease-in-out infinite; }
  .sp-shadow { animation: sp-shadow 6s ease-in-out infinite; }
  .sp-line  { stroke-dasharray: 1; stroke-dashoffset: 1; animation: sp-draw var(--d, 0.5s) cubic-bezier(0.65, 0, 0.35, 1) var(--t, 0s) both; }
  .sp-fade  { opacity: 0; transform-origin: center; animation: sp-in 0.5s ease-out var(--t, 0s) both; }
  .sp-pop   { opacity: 0; transform-origin: center; animation: sp-pop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) var(--t, 0s) both; }
  .sp-mark  { opacity: 0; transform-origin: center; animation: sp-mark 0.9s ease-out var(--t, 0s) both; }
  .sp-wash  { transform-origin: 0 50%; animation: sp-wash 1.1s cubic-bezier(0.65, 0, 0.35, 1) var(--t, 0s) both; }
  .sp-sweep { animation: sp-sweep 1.2s ease-in-out var(--t, 0s) both; }
  .sp-out   { animation: sp-out 0.6s ease-in var(--t, 0s) both; }

  @media (prefers-reduced-motion: reduce) {
    .sp-float, .sp-shadow, .sp-line, .sp-fade, .sp-pop, .sp-mark, .sp-wash, .sp-sweep, .sp-out {
      animation: none !important;
    }
    .sp-line { stroke-dashoffset: 0; opacity: 1; }
    .sp-fade, .sp-pop { opacity: 1; }
    .sp-mark, .sp-sweep, .sp-motion { display: none; }
  }
`;

/**
 * The paper the sheet is printed on, floating over its shadow. No 3D transform and no CSS
 * filter on the SVG: either makes the browser rasterise it and scale the bitmap, which is
 * what blurred the first version.
 */
export function SheetStage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`sp-stage relative w-[260px] sm:w-[300px] ${className}`} aria-hidden="true">
      <style>{SHEET_KEYFRAMES}</style>
      <div className="sp-float relative">
        <div className="absolute inset-0 rounded-[4px] shadow-[0_1px_2px_rgba(28,25,23,0.08),0_18px_40px_-12px_rgba(28,25,23,0.28)]" />
        {children}
      </div>
      <div className="sp-shadow mx-auto mt-4 h-3 w-2/3 rounded-[50%] bg-stone-900/15 blur-md" />
    </div>
  );
}

/** Heading, compass and logo: what makes a drawing the customer's sheet. */
export function SheetBranding({ start }: { start: number }) {
  return (
    <>
      <text
        className="sp-fade"
        x="105"
        y="44"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="600"
        letterSpacing="3"
        fill={INK}
        fontFamily={FONT}
        style={at(start)}
      >
        PLANLÖSNING
      </text>
      <g className="sp-pop" style={at(start + 0.25)}>
        <circle cx="181" cy="40" r="8.5" fill="none" stroke={INK} strokeWidth="0.6" />
        <path d="M181 32.5 L184 40 L181 38.4 L178 40 Z" fill={INK} />
        <path d="M181 47.5 L184 40 L181 41.6 L178 40 Z" fill="none" stroke={INK} strokeWidth="0.5" />
        <text x="181" y="29.5" textAnchor="middle" fontSize="4.2" fontWeight="700" fill={INK} fontFamily={FONT}>
          N
        </text>
      </g>
      <image
        className="sp-fade"
        href={TENANT.logoSrc}
        x="70"
        y="262"
        width="70"
        height={(70 * TENANT.logoHeight) / TENANT.logoWidth}
        preserveAspectRatio="xMidYMid meet"
        style={at(start + 0.5)}
      />
    </>
  );
}

export function RoomLabels({ start, step = 0.12 }: { start: number; step?: number }) {
  return (
    <g fontSize="6" fontWeight="600" fill={INK} textAnchor="middle" letterSpacing="0.4" fontFamily={FONT}>
      {LABELS.map((label, index) => (
        <text key={label.text} className="sp-fade" x={label.x} y={label.y} style={at(start + index * step)}>
          {label.text}
        </text>
      ))}
    </g>
  );
}

export function SheetFrame({ start, duration = 1.6 }: { start: number; duration?: number }) {
  return (
    <rect
      className="sp-line"
      pathLength={1}
      x="9"
      y="9"
      width="192"
      height="279"
      fill="none"
      stroke={INK}
      strokeWidth="0.6"
      style={at(start, duration)}
    />
  );
}

/** A soft highlight passing over the finished sheet. */
export function SheetShine({ start }: { start: number }) {
  return (
    <>
      <defs>
        <linearGradient id="sp-shine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect className="sp-sweep" x="0" y="-20" width="60" height="340" fill="url(#sp-shine)" style={at(start)} />
    </>
  );
}

/** The finished drawing, all at once: used where it is revealed rather than drawn. */
export function StaticPlan() {
  return (
    <>
      <path d={OUTER_WALL} fill="none" stroke={INK} strokeWidth="4.2" strokeLinejoin="miter" />
      <g stroke={INK} strokeWidth="2.6" strokeLinecap="square">
        {WALLS.slice(4).map((wall, index) => (
          <line key={index} {...wall} />
        ))}
      </g>
      <g stroke={PAPER} strokeWidth="2">
        {WINDOWS.map((window, index) => (
          <line key={index} {...window} />
        ))}
      </g>
      <g stroke="var(--tenant-accent)" strokeWidth="0.9" fill="none" strokeLinecap="round">
        {DOORS.map((door) => (
          <path key={door} d={door} />
        ))}
      </g>
      <g stroke={INK} strokeWidth="0.8" fill="none">
        {FIXTURES.map((fixture) => (
          <path key={fixture} d={fixture} />
        ))}
        <circle {...STOVE} />
      </g>
    </>
  );
}


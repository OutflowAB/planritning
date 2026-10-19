"use client";

import {
  at,
  BEIGE,
  FONT,
  INK,
  LABELS,
  PAPER,
  RoomLabels,
  SheetBranding,
  SheetShine,
  SheetStage,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  StaticPlan,
  WALLS,
} from "./sheet-parts";
import { useLoopKey } from "./use-loop-key";

/**
 * Förslag B — "Före och efter". An old, hand-drawn plan on yellowed paper is read by a beam
 * in the customer's colour; behind the beam the crisp new drawing is already there, and the
 * corners light up as the beam finds them. Then the house colour, labels and branding land.
 */

const LOOP_MS = 10500;

const BEAM_BEGIN = 0.9;
const BEAM_SECONDS = 3.6;
const BEAM_FROM = -30;
const BEAM_TO = 252;

/** When the beam reaches a given x, in seconds from mount. */
function beamAt(x: number) {
  return BEAM_BEGIN + (BEAM_SECONDS * (x - BEAM_FROM)) / (BEAM_TO - BEAM_FROM);
}

/** Deterministic jitter, so the sketch is wobbly but the same every loop. */
function jitter(seed: number, amount: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  // Rounded so server and browser agree: their Math.sin may differ in the last digits.
  return Math.round((value - Math.floor(value) - 0.5) * 2 * amount * 100) / 100;
}

/** A pencil stroke: a slightly bowed, slightly overshooting line. */
function sketchStroke(x1: number, y1: number, x2: number, y2: number, seed: number) {
  const r = (value: number) => value.toFixed(2);
  const mx = (x1 + x2) / 2 + jitter(seed, 1.6);
  const my = (y1 + y2) / 2 + jitter(seed + 1, 1.6);
  return `M${r(x1 + jitter(seed + 2, 1.4))} ${r(y1 + jitter(seed + 3, 1.4))} Q${r(mx)} ${r(my)} ${r(
    x2 + jitter(seed + 4, 1.8),
  )} ${r(y2 + jitter(seed + 5, 1.8))}`;
}

/** Where the walls meet: what the beam "finds". */
const CORNERS = [
  [30, 100],
  [180, 100],
  [180, 220],
  [30, 220],
  [110, 100],
  [30, 172],
  [180, 172],
  [148, 220],
  [110, 172],
] as const;

export function ScanAnimation() {
  const cycle = useLoopKey(LOOP_MS);
  const revealStart = (0 - BEAM_FROM) / (BEAM_TO - BEAM_FROM);
  const revealEnd = (SHEET_WIDTH - BEAM_FROM) / (BEAM_TO - BEAM_FROM);

  return (
    <SheetStage>
      <svg
        key={cycle}
        viewBox={`0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}`}
        shapeRendering="geometricPrecision"
        className="relative block h-auto w-full rounded-[4px]"
      >
        <defs>
          <clipPath id="sp-b-clip">
            <rect width={SHEET_WIDTH} height={SHEET_HEIGHT} rx="4" />
          </clipPath>
          <clipPath id="sp-b-reveal">
            <rect x="0" y="0" width="0" height={SHEET_HEIGHT}>
              <animate
                attributeName="width"
                values={`0;0;${SHEET_WIDTH};${SHEET_WIDTH}`}
                keyTimes={`0;${revealStart.toFixed(3)};${revealEnd.toFixed(3)};1`}
                dur={`${BEAM_SECONDS}s`}
                begin={`${BEAM_BEGIN}s`}
                fill="freeze"
              />
            </rect>
          </clipPath>
          <filter id="sp-b-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
            <feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.27  0 0 0 0 0.16  0 0 0 0.09 0" />
          </filter>
          <linearGradient id="sp-b-beam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--tenant-accent)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--tenant-accent)" stopOpacity="0.32" />
          </linearGradient>
          <pattern id="sp-b-scanlines" width="4" height="3" patternUnits="userSpaceOnUse">
            <rect width="4" height="0.5" fill="var(--tenant-accent)" opacity="0.35" />
          </pattern>
        </defs>

        <g className="sp-out" clipPath="url(#sp-b-clip)" style={at((LOOP_MS - 700) / 1000)}>
          {/* Före: gulnat papper, blyerts och handstil */}
          <g className="sp-fade" style={at(0)}>
            <rect width={SHEET_WIDTH} height={SHEET_HEIGHT} fill="#efe5cf" />
            <rect width={SHEET_WIDTH} height={SHEET_HEIGHT} filter="url(#sp-b-grain)" />
            <circle cx="168" cy="252" r="17" fill="none" stroke="#b9925a" strokeWidth="2.4" opacity="0.18" />
            <g transform="rotate(-1.4 105 160)" fill="none" stroke="#4a4540" strokeLinecap="round" opacity="0.85">
              {WALLS.map((wall, index) => (
                <g key={index}>
                  <path d={sketchStroke(wall.x1, wall.y1, wall.x2, wall.y2, index * 7)} strokeWidth="1.3" />
                  <path
                    d={sketchStroke(wall.x1, wall.y1, wall.x2, wall.y2, index * 7 + 3)}
                    strokeWidth="0.6"
                    opacity="0.6"
                  />
                </g>
              ))}
              <path d="M78 172 A22 22 0 0 1 100 150" strokeWidth="0.6" strokeDasharray="2 1.5" />
              <path d="M117 106 L174 107 L175 116 L116 115 Z" strokeWidth="0.6" />
              <g
                fill="#4a4540"
                stroke="none"
                fontSize="7"
                fontStyle="italic"
                fontFamily="'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive"
              >
                {LABELS.map((label, index) => (
                  <text
                    key={label.text}
                    x={(label.x + jitter(index, 4)).toFixed(2)}
                    y={(label.y + jitter(index + 9, 3)).toFixed(2)}
                    textAnchor="middle"
                  >
                    {label.text.charAt(0) + label.text.slice(1).toLocaleLowerCase("sv-SE")}
                  </text>
                ))}
                <text x="105" y="62" textAnchor="middle" fontSize="9">
                  Ritn. 1962
                </text>
              </g>
            </g>
          </g>

          {/* Efter: den nya ritningen, synlig bakom strålen */}
          <g clipPath="url(#sp-b-reveal)">
            <rect width={SHEET_WIDTH} height={SHEET_HEIGHT} fill={PAPER} />
            <rect className="sp-wash" width={SHEET_WIDTH} height={SHEET_HEIGHT} fill={BEIGE} style={at(5.0)} />
            <rect x="9" y="9" width="192" height="279" fill="none" stroke={INK} strokeWidth="0.6" />
            <StaticPlan />
            <g stroke={INK} strokeWidth="0.45" fill="none" opacity="0.7">
              <path d="M30 90 H180 M30 87 V93 M180 87 V93" />
              <path d="M20 100 V220 M17 100 H23 M17 220 H23" />
            </g>
            <g fontSize="5.5" fill={INK} textAnchor="middle" fontFamily={FONT} opacity="0.75">
              <text x="105" y="85">
                12,4 m
              </text>
              <text x="14" y="162" transform="rotate(-90 14 162)">
                9,8 m
              </text>
            </g>
          </g>

          {/* Hörn som hittas när strålen passerar */}
          <g stroke="var(--tenant-accent)" strokeWidth="0.9" fill="none" strokeLinecap="round">
            {CORNERS.map(([x, y]) => (
              <path
                key={`${x}-${y}`}
                className="sp-mark"
                d={`M${x - 6} ${y - 2.5} V${y - 6} H${x - 2.5} M${x + 2.5} ${y - 6} H${x + 6} V${y - 2.5} M${
                  x + 6
                } ${y + 2.5} V${y + 6} H${x + 2.5} M${x - 2.5} ${y + 6} H${x - 6} V${y + 2.5}`}
                style={at(beamAt(x))}
              />
            ))}
          </g>

          {/* Strålen */}
          <g className="sp-motion" transform={`translate(${BEAM_FROM} 0)`}>
            <animateTransform
              attributeName="transform"
              type="translate"
              from={`${BEAM_FROM} 0`}
              to={`${BEAM_TO} 0`}
              dur={`${BEAM_SECONDS}s`}
              begin={`${BEAM_BEGIN}s`}
              fill="freeze"
            />
            <rect x="-34" y="0" width="34" height={SHEET_HEIGHT} fill="url(#sp-b-beam)" />
            <rect x="-34" y="0" width="34" height={SHEET_HEIGHT} fill="url(#sp-b-scanlines)" opacity="0.5" />
            <rect x="-0.6" y="0" width="1.2" height={SHEET_HEIGHT} fill="var(--tenant-accent)" />
            <rect x="-3" y="0" width="6" height={SHEET_HEIGHT} fill="var(--tenant-accent)" opacity="0.15" />
          </g>

          <RoomLabels start={5.6} />
          <SheetBranding start={6.2} />
          <SheetShine start={7.6} />
        </g>
      </svg>
    </SheetStage>
  );
}

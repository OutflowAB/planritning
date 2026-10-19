"use client";

import {
  COMPASS_GEOMETRY,
  compassLayout,
  compassLetterTilt,
  compassNeedlePoints,
} from "@/lib/image/compass-geometry";
import {
  COMPASS_DIRECTIONS,
  nearestCompassDirection,
  type CompassSettings,
} from "@/lib/image/compass-settings";

type CompassControlProps = {
  value: CompassSettings;
  onChange: (next: CompassSettings) => void;
  disabled?: boolean;
  /** When set, the control is switched off and this says why. */
  unavailableReason?: string | null;
  /** A new sheet is being composed. */
  busy?: boolean;
};

/** Where each direction sits in the 3x3 grid (row, column), as on a map. */
const GRID_POSITION: Record<string, { row: number; column: number }> = {
  NV: { row: 1, column: 1 },
  N: { row: 1, column: 2 },
  NO: { row: 1, column: 3 },
  V: { row: 2, column: 1 },
  O: { row: 2, column: 3 },
  SV: { row: 3, column: 1 },
  S: { row: 3, column: 2 },
  SO: { row: 3, column: 3 },
};

/** The badge as the sheet draws it, small, upright letters and all. */
export function CompassPreview({ rotation, visible }: { rotation: number; visible: boolean }) {
  const layout = compassLayout(1);
  const needle = compassNeedlePoints(layout.innerRadius);
  const pt = (p: { x: number; y: number }) => `${p.x},${p.y}`;

  return (
    <svg
      viewBox="-1.12 -1.12 2.24 2.24"
      role="img"
      aria-label={`Kompass, norr pekar ${Math.round(rotation)} grader medurs från överkanten`}
      data-testid="compass-preview"
      data-rotation={rotation}
      className={`h-full w-full select-none bg-[#e1d4c8] ${visible ? "" : "opacity-30"}`}
    >
      <g transform={`rotate(${rotation})`} fill="none" stroke="#000" strokeWidth={0.03}>
        <circle r={1} />
        <circle r={layout.innerRadius} />
        {[45, 135, 225, 315].map((angle) => (
          <line
            key={angle}
            x1={0}
            y1={-layout.innerRadius}
            x2={0}
            y2={-1}
            transform={`rotate(${angle})`}
          />
        ))}
        <polygon points={`${pt(needle.north)} ${pt(needle.west)} ${pt(needle.tail)}`} fill="#000" />
        <polygon points={`${pt(needle.north)} ${pt(needle.east)} ${pt(needle.tail)}`} />
      </g>
      {(["N", "E", "S", "W"] as const).map((letter, index) => {
        const angle = ((rotation + index * 90) * Math.PI) / 180;
        const x = Math.sin(angle) * layout.letterRadius;
        const y = -Math.cos(angle) * layout.letterRadius;
        return (
          <text
            key={letter}
            x={x}
            y={y}
            transform={`rotate(${compassLetterTilt(rotation)} ${x} ${y})`}
            fontSize={COMPASS_GEOMETRY.letterSizeRatio / 0.7}
            fontWeight={700}
            fontFamily="Questrial, Helvetica, Arial, sans-serif"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#000"
          >
            {letter}
          </text>
        );
      })}
    </svg>
  );
}

/**
 * Show or hide the sheet's compass and pick which way north points: one of eight directions,
 * laid out like a compass rose around the live badge. Used before a plan is drawn (the choice
 * goes with the request) and in the review (the sheet is composed again).
 */
export function CompassControl({
  value,
  onChange,
  disabled = false,
  unavailableReason = null,
  busy = false,
}: CompassControlProps) {
  const off = disabled || Boolean(unavailableReason);
  const directionOff = off || !value.visible;
  // A stored plan from before may hold any angle: show the closest of the eight.
  const selected = nearestCompassDirection(value.rotation);

  return (
    <fieldset
      className="flex flex-wrap items-center gap-x-5 gap-y-3 border border-stone-100 bg-white px-3 py-3"
      aria-label="Kompass"
      disabled={off}
    >
      <div
        role="radiogroup"
        aria-label="Norr pekar åt"
        className="grid shrink-0 grid-cols-[3rem_3rem_3rem] grid-rows-[3rem_3rem_3rem] gap-1"
      >
        {COMPASS_DIRECTIONS.map((direction) => {
          const active = direction.key === selected.key;
          const position = GRID_POSITION[direction.key];
          return (
            <button
              key={direction.key}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={direction.name}
              title={direction.name}
              disabled={directionOff}
              data-direction={direction.key}
              onClick={() => onChange({ ...value, rotation: direction.rotation })}
              style={{ gridRow: position.row, gridColumn: position.column }}
              className={`inline-flex items-center justify-center rounded-lg border text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? "border-primary bg-primary text-white"
                  : "border-stone-200 bg-white text-stone-800 hover:bg-stone-100"
              }`}
            >
              {direction.key}
            </button>
          );
        })}
        <div style={{ gridRow: 2, gridColumn: 2 }} className="overflow-hidden">
          <CompassPreview rotation={selected.rotation} visible={value.visible} />
        </div>
      </div>
      <div className="min-w-[160px] flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-stone-800">
            <input
              type="checkbox"
              checked={value.visible}
              onChange={(event) => onChange({ ...value, visible: event.target.checked })}
              className="h-4 w-4 accent-stone-700"
            />
            Visa kompass på planritningen
          </label>
          {busy ? <span className="text-xs text-stone-500">Uppdaterar…</span> : null}
        </div>
        <p className="text-xs text-stone-500">
          {unavailableReason ?? "Välj åt vilket håll norr pekar på planritningen."}
        </p>
      </div>
    </fieldset>
  );
}

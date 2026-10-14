"use client";

import { RotateCcw } from "lucide-react";
import { PointerEvent, useRef } from "react";

import {
  COMPASS_GEOMETRY,
  compassLayout,
  compassLetterTilt,
  compassNeedlePoints,
} from "@/lib/image/compass-geometry";
import { normaliseRotation, type CompassSettings } from "@/lib/image/compass-settings";

type CompassControlProps = {
  value: CompassSettings;
  /** What "Återställ" goes back to: the scan's own direction, or hidden and north-up. */
  defaultValue: CompassSettings;
  onChange: (next: CompassSettings) => void;
  disabled?: boolean;
  /** When set, the control is switched off and this says why. */
  unavailableReason?: string | null;
  /** A new sheet is being composed. */
  busy?: boolean;
};

const STEPS = [-90, -15, 15, 90] as const;

/** The badge as the sheet draws it, small, upright letters and all. Drag it to turn it. */
function CompassPreview({
  rotation,
  visible,
  interactive,
  onRotate,
}: {
  rotation: number;
  visible: boolean;
  interactive: boolean;
  onRotate: (degrees: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);
  const layout = compassLayout(1);
  const needle = compassNeedlePoints(layout.innerRadius);
  const pt = (p: { x: number; y: number }) => `${p.x},${p.y}`;

  function rotateTowards(event: PointerEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    if (Math.hypot(dx, dy) < 4) return;
    onRotate(Math.round((Math.atan2(dx, -dy) * 180) / Math.PI));
  }

  return (
    <svg
      ref={svgRef}
      viewBox="-1.12 -1.12 2.24 2.24"
      role="img"
      aria-label={`Kompass, norr pekar ${Math.round(rotation)} grader medurs från överkanten`}
      data-testid="compass-preview"
      className={`h-24 w-24 shrink-0 touch-none select-none bg-[#e1d4c8] ${
        interactive ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      } ${visible ? "" : "opacity-30"}`}
      onPointerDown={(event) => {
        if (!interactive) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        rotateTowards(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) rotateTowards(event);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
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
 * Show or hide the sheet's compass and set where north points. Used before a plan is drawn
 * (the choice goes with the request) and in the review (the sheet is composed again).
 */
export function CompassControl({
  value,
  defaultValue,
  onChange,
  disabled = false,
  unavailableReason = null,
  busy = false,
}: CompassControlProps) {
  const off = disabled || Boolean(unavailableReason);
  const rotationOff = off || !value.visible;
  const atDefault =
    value.visible === defaultValue.visible &&
    (!value.visible || normaliseRotation(value.rotation) === normaliseRotation(defaultValue.rotation));

  const set = (patch: Partial<CompassSettings>) => onChange({ ...value, ...patch });
  const turn = (degrees: number) => set({ rotation: normaliseRotation(value.rotation + degrees) });
  const buttonClass =
    "inline-flex h-8 min-w-10 items-center justify-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <fieldset
      className="flex flex-wrap items-center gap-4 border border-[#e8e2d8] bg-white px-3 py-3"
      aria-label="Kompass"
      disabled={off}
    >
      <CompassPreview
        rotation={value.rotation}
        visible={value.visible}
        interactive={!rotationOff}
        onRotate={(degrees) => set({ rotation: normaliseRotation(degrees) })}
      />
      <div className="min-w-[220px] flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#4d463f]">
            <input
              type="checkbox"
              checked={value.visible}
              onChange={(event) => set({ visible: event.target.checked })}
              className="h-4 w-4 accent-[#5c544a]"
            />
            Visa kompass på planritningen
          </label>
          {busy ? <span className="text-xs text-[#7b746a]">Uppdaterar…</span> : null}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={Math.round(value.rotation) % 360}
            disabled={rotationOff}
            onChange={(event) => set({ rotation: Number(event.target.value) })}
            aria-label="Norr pekar (grader medurs)"
            className="min-w-0 flex-1 accent-[#5c544a] disabled:opacity-50"
          />
          <span className="w-12 text-right text-xs font-semibold tabular-nums text-[#6a6258]">
            {Math.round(value.rotation) % 360}°
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STEPS.map((step) => (
            <button
              key={step}
              type="button"
              disabled={rotationOff}
              onClick={() => turn(step)}
              className={buttonClass}
            >
              {step > 0 ? `+${step}°` : `−${Math.abs(step)}°`}
            </button>
          ))}
          <button
            type="button"
            disabled={off || atDefault}
            onClick={() => onChange(defaultValue)}
            className={buttonClass}
          >
            <RotateCcw size={12} aria-hidden="true" />
            Återställ
          </button>
        </div>
        <p className="text-xs text-[#7b746a]">
          {unavailableReason ?? "Dra i kompassen, flytta reglaget eller använd knapparna. Norr pekar uppåt vid 0°."}
        </p>
      </div>
    </fieldset>
  );
}

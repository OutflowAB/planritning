"use client";

import { useEffect, useState } from "react";

import { DEMO_PLANS, type DemoPlan } from "./plans";
import {
  at,
  BEIGE,
  FONT,
  INK,
  PAPER,
  SHEET_HEIGHT,
  SHEET_KEYFRAMES,
  SHEET_WIDTH,
  SheetShine,
} from "./sheet-parts";
import { TENANT } from "@/lib/brand";
import { useLoopKey, useReducedMotion } from "./use-loop-key";

/**
 * "Ritbordet". A new sheet slides in and draws itself: a pen traces the outer walls leaving a
 * glowing trail, then inner walls, windows, doors and fixtures; the dimensions count up; the
 * house colour washes over; room names type themselves out with their areas; heading, compass
 * and logo land; and the finished sheet is laid on the pile as the next one comes in. Each
 * loop draws a different home, so a long wait does not look like one clip on repeat.
 */

const LOOP_MS = 10000;

const DRAFTING_KEYFRAMES = `
  /* The new sheet floats in from the right while the finished one is laid on the pile. */
  @keyframes sp-sheet-in {
    0%   { opacity: 0; transform: translate(74px, -14px) rotate(7deg); }
    15%  { opacity: 1; }
    100% { opacity: 1; transform: none; }
  }
  /* Ends exactly where the top sheet of the pile lies, then dissolves into it. */
  @keyframes sp-sheet-leave {
    0%   { opacity: 1; transform: none; }
    72%  { opacity: 1; transform: translate(-10px, 8px) rotate(-4deg) scale(0.985); }
    100% { opacity: 0; transform: translate(-10px, 8px) rotate(-4deg) scale(0.985); }
  }
  @keyframes sp-type      { from { fill-opacity: 0; stroke-opacity: 0; } to { fill-opacity: 1; stroke-opacity: 1; } }
  /* A room "found": a soft wave of the customer's colour spreading from its name. */
  @keyframes sp-bloom     { 0% { opacity: 0; transform: scale(0.05); } 2% { opacity: 0.55; } 100% { opacity: 0; transform: scale(1); } }
  /* Sparks thrown off as the logo is stamped on. */
  @keyframes sp-burst {
    0%   { opacity: 0; transform: translate(0, 0) scale(1); }
    15%  { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.2); }
  }
  /* A slow push-in on the drawing while it is made. */
  @keyframes sp-dolly     { from { transform: scale(1.09); } to { transform: none; } }
  @keyframes sp-gone      { to { opacity: 0; } }
  @keyframes sp-stamp     { 0% { opacity: 0; transform: scale(1.35); } 55% { opacity: 1; transform: scale(0.96); } 100% { opacity: 1; transform: none; } }
  @keyframes sp-track     { from { opacity: 0; letter-spacing: 9px; } to { opacity: 1; letter-spacing: 3px; } }

  .sp-sheet       { animation: sp-sheet-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.18s both; }
  .sp-sheet-leave { animation: sp-sheet-leave 0.85s cubic-bezier(0.65, 0, 0.35, 1) forwards; }
  .sp-type  { fill-opacity: 0; stroke-opacity: 0; animation: sp-type 0.12s linear var(--t, 0s) both; }
  .sp-bloom { opacity: 0; transform-origin: center; animation: sp-bloom 1.3s cubic-bezier(0.22, 1, 0.36, 1) var(--t, 0s) both; }
  .sp-burst { opacity: 0; animation: sp-burst 0.9s cubic-bezier(0.22, 1, 0.36, 1) var(--t, 0s) both; }
  .sp-dolly { transform-origin: center; animation: sp-dolly 7s cubic-bezier(0.25, 0.6, 0.3, 1) both; }
  .sp-gone  { animation: sp-gone 0.8s ease-out var(--t, 0s) forwards; }
  .sp-stamp { opacity: 0; transform-origin: center; animation: sp-stamp 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) var(--t, 0s) both; }
  .sp-track { opacity: 0; animation: sp-track 0.9s cubic-bezier(0.22, 1, 0.36, 1) var(--t, 0s) both; }

  @media (prefers-reduced-motion: reduce) {
    .sp-sheet, .sp-type, .sp-gone, .sp-stamp, .sp-track, .sp-dolly { animation: none !important; }
    .sp-sheet-leave, .sp-bloom, .sp-burst { display: none; }
    .sp-type { fill-opacity: 1; stroke-opacity: 1; }
    .sp-stamp, .sp-track { opacity: 1; }
    .sp-gone { display: none; }
  }
`;

const easeOut = (value: number) => 1 - (1 - value) ** 3;

/** A number counting up from zero once, starting `delay` seconds after mount. */
function CountUp({
  to,
  delay,
  decimals = 0,
  duration = 0.9,
}: {
  to: number;
  delay: number;
  decimals?: number;
  duration?: number;
}) {
  const reduceMotion = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    let frame = 0;
    const startAt = performance.now() + delay * 1000;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startAt) / (duration * 1000)));
      setValue(to * easeOut(progress));
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [to, delay, duration, reduceMotion]);

  return <>{(reduceMotion ? to : value).toFixed(decimals).replace(".", ",")}</>;
}

/** Text that types itself out, one letter at a time. */
function Typed({ text, start, step = 0.035 }: { text: string; start: number; step?: number }) {
  return (
    <>
      {Array.from(text).map((letter, index) => (
        <tspan key={index} className="sp-type" style={at(start + index * step)}>
          {letter}
        </tspan>
      ))}
    </>
  );
}

function line(segment: { x1: number; y1: number; x2: number; y2: number }) {
  return `M${segment.x1} ${segment.y1} L${segment.x2} ${segment.y2}`;
}

/** Where sparks fly when the logo lands: evenly round, at slightly uneven distances. */
const SPARKS = Array.from({ length: 12 }, (_, index) => {
  const angle = (index / 12) * Math.PI * 2;
  const distance = 16 + (index % 3) * 5;
  return { dx: Math.round(Math.cos(angle) * distance * 10) / 10, dy: Math.round(Math.sin(angle) * distance * 0.6 * 10) / 10 };
});

/** Paper-coloured outline behind text, as on real plans, so lines never cut through it. */
const HALO = { stroke: BEIGE, strokeWidth: 2.4, strokeLinejoin: "round" as const, paintOrder: "stroke" };

function Sheet({ plan, planIndex }: { plan: DemoPlan; planIndex: number }) {
  const { box } = plan;
  const dimensionY = box.y - 10;
  const dimensionX = box.x - 10;
  const roomsClipId = `sp-a-rooms-${planIndex}`;
  const logoHeight = (70 * TENANT.logoHeight) / TENANT.logoWidth;

  return (
    <svg
      viewBox={`0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}`}
      shapeRendering="geometricPrecision"
      className="relative block h-auto w-full rounded-[4px]"
    >
      <defs>
        <clipPath id="sp-a-clip">
          <rect width={SHEET_WIDTH} height={SHEET_HEIGHT} rx="4" />
        </clipPath>
        <clipPath id={roomsClipId}>
          <path d={plan.outer} />
        </clipPath>
      </defs>
      <rect width={SHEET_WIDTH} height={SHEET_HEIGHT} rx="4" fill={PAPER} />

      <g clipPath="url(#sp-a-clip)">
        <rect className="sp-wash" width={SHEET_WIDTH} height={SHEET_HEIGHT} fill={BEIGE} style={at(4.4)} />
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
          style={at(0.3, 1.3)}
        />

        <g className="sp-dolly">
          {/* Mått, som räknas upp, med hjälplinjer och en mätlaser */}
          <g stroke="var(--tenant-accent)" strokeWidth="0.4" strokeDasharray="1 1.4" fill="none">
            <path
              className="sp-fade"
              d={`M${box.x} ${box.y - 3} V${dimensionY - 4} M${box.x + box.width} ${box.y - 3} V${dimensionY - 4}`}
              style={at(3.5)}
            />
            <path
              className="sp-fade"
              d={`M${box.x - 3} ${box.y} H${dimensionX - 4} M${box.x - 3} ${box.y + box.height} H${dimensionX - 4}`}
              style={at(3.65)}
            />
          </g>
          <g stroke={INK} strokeWidth="0.45" fill="none" opacity="0.7">
            <path
              className="sp-line"
              pathLength={1}
              d={`M${box.x} ${dimensionY} H${box.x + box.width} M${box.x} ${dimensionY - 3} V${dimensionY + 3} M${
                box.x + box.width
              } ${dimensionY - 3} V${dimensionY + 3}`}
              style={at(3.6, 0.6)}
            />
            <path
              className="sp-line"
              pathLength={1}
              d={`M${dimensionX} ${box.y} V${box.y + box.height} M${dimensionX - 3} ${box.y} H${dimensionX + 3} M${
                dimensionX - 3
              } ${box.y + box.height} H${dimensionX + 3}`}
              style={at(3.75, 0.6)}
            />
          </g>
          <g fontSize="5.5" fill={INK} textAnchor="middle" fontFamily={FONT} opacity="0.75">
            <text className="sp-fade" x={box.x + box.width / 2} y={dimensionY - 4} style={at(3.8)}>
              <CountUp to={plan.widthMetres} delay={3.8} decimals={1} /> m
            </text>
            <text
              className="sp-fade"
              x={dimensionX - 5}
              y={box.y + box.height / 2}
              transform={`rotate(-90 ${dimensionX - 5} ${box.y + box.height / 2})`}
              style={at(3.9)}
            >
              <CountUp to={plan.heightMetres} delay={3.9} decimals={1} /> m
            </text>
          </g>
          <g className="sp-motion" opacity="0">
            <circle r="4" fill="var(--tenant-accent)" opacity="0.2" />
            <circle r="1.4" fill="var(--tenant-accent)" />
            <animateMotion
              path={`M${box.x} ${dimensionY} H${box.x + box.width}`}
              dur="0.9s"
              begin="3.7s"
              fill="freeze"
            />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="1s" begin="3.65s" fill="freeze" />
          </g>
          <g className="sp-motion" opacity="0">
            <circle r="4" fill="var(--tenant-accent)" opacity="0.2" />
            <circle r="1.4" fill="var(--tenant-accent)" />
            <animateMotion
              path={`M${dimensionX} ${box.y} V${box.y + box.height}`}
              dur="0.9s"
              begin="3.85s"
              fill="freeze"
            />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="1s" begin="3.8s" fill="freeze" />
          </g>

          {/* Pennans glödande spår, som mörknar till bläck */}
          <g className="sp-gone" style={at(2.3)}>
            <path
              className="sp-line"
              pathLength={1}
              d={plan.outer}
              fill="none"
              stroke="var(--tenant-accent)"
              strokeOpacity="0.28"
              strokeWidth="9"
              strokeLinejoin="round"
              style={{ ...at(0.45, 1.5), animationTimingFunction: "linear" }}
            />
          </g>
          <path
            className="sp-line"
            pathLength={1}
            d={plan.outer}
            fill="none"
            stroke={INK}
            strokeWidth="4.2"
            style={{ ...at(0.5, 1.5), animationTimingFunction: "linear" }}
          />

          <g stroke={INK} strokeWidth="2.6" strokeLinecap="square" fill="none">
            {plan.inner.map((wall, index) => (
              <path key={index} className="sp-line" pathLength={1} d={line(wall)} style={at(1.95 + index * 0.09, 0.32)} />
            ))}
          </g>
          <g stroke={PAPER} strokeWidth="2" fill="none">
            {plan.windows.map((window, index) => (
              <path key={index} className="sp-line" pathLength={1} d={line(window)} style={at(2.6 + index * 0.07, 0.28)} />
            ))}
          </g>
          <g stroke="var(--tenant-accent)" strokeWidth="0.9" fill="none" strokeLinecap="round">
            {plan.doors.map((door, index) => (
              <path key={door} className="sp-line" pathLength={1} d={door} style={at(2.95 + index * 0.13, 0.45)} />
            ))}
          </g>
          <g stroke={INK} strokeWidth="0.8" fill="none">
            {plan.fixtures.map((fixture, index) => (
              <path key={fixture} className="sp-line" pathLength={1} d={fixture} style={at(3.3 + index * 0.08, 0.45)} />
            ))}
            {plan.circles.map((circle, index) => (
              <circle key={index} className="sp-line" pathLength={1} {...circle} style={at(3.45 + index * 0.08, 0.35)} />
            ))}
          </g>

          {/* Rummen hittas: en våg i er färg från varje rumsnamn */}
          <g clipPath={`url(#${roomsClipId})`}>
            {plan.rooms.map((room, index) => (
              <circle
                key={`${room.name}-${index}`}
                className="sp-bloom"
                cx={room.x}
                cy={room.y}
                r="42"
                fill="var(--tenant-accent)"
                fillOpacity="0.35"
                style={at(5.15 + index * 0.32)}
              />
            ))}
          </g>

          {/* Rumsnamn som skrivs fram, med yta */}
          <g textAnchor="middle" fontFamily={FONT} fill={INK}>
            {plan.rooms.map((room, index) => {
              const start = 5.2 + index * 0.32;
              return (
                <g key={`${room.name}-${index}`}>
                  <text x={room.x} y={room.y} fontSize="6" fontWeight="600" letterSpacing="0.4" {...HALO}>
                    <Typed text={room.name} start={start} />
                  </text>
                  <text
                    className="sp-fade"
                    x={room.x}
                    y={room.y + 7}
                    fontSize="4.6"
                    fillOpacity="0.7"
                    {...HALO}
                    strokeWidth={2}
                    style={at(start + 0.2)}
                  >
                    <CountUp to={room.area} delay={start + 0.2} duration={0.7} /> m²
                  </text>
                </g>
              );
            })}
          </g>

          {/* Pennan */}
          <g className="sp-motion" opacity="0">
            <circle r="8" fill="var(--tenant-accent)" opacity="0.16" />
            <circle r="2.6" fill="var(--tenant-accent)" />
            <circle r="1" fill="#ffffff" />
            <animateMotion path={plan.outer} dur="1.5s" begin="0.5s" fill="freeze" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.9;1" dur="1.65s" begin="0.45s" fill="freeze" />
          </g>
        </g>

        {/* Rubrik, kompass och logotyp */}
        <text
          className="sp-track"
          x="105"
          y="44"
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="600"
          fill={INK}
          fontFamily={FONT}
          style={at(6.6)}
        >
          PLANLÖSNING
        </text>
        <g className="sp-pop" style={at(6.85)}>
          <circle cx="181" cy="40" r="8.5" fill="none" stroke={INK} strokeWidth="0.6" />
          <path d="M181 32.5 L184 40 L181 38.4 L178 40 Z" fill={INK} />
          <path d="M181 47.5 L184 40 L181 41.6 L178 40 Z" fill="none" stroke={INK} strokeWidth="0.5" />
          <text x="181" y="29.5" textAnchor="middle" fontSize="4.2" fontWeight="700" fill={INK} fontFamily={FONT}>
            N
          </text>
        </g>
        <image
          className="sp-stamp"
          href={TENANT.logoSrc}
          x="70"
          y="262"
          width="70"
          height={logoHeight}
          preserveAspectRatio="xMidYMid meet"
          style={at(7.2)}
        />
        <g fill="var(--tenant-accent)">
          {SPARKS.map((spark, index) => (
            <circle
              key={index}
              className="sp-burst"
              cx="105"
              cy={262 + logoHeight / 2}
              r={index % 2 ? 0.7 : 1}
              style={{ ...at(7.3 + (index % 4) * 0.02), "--dx": `${spark.dx}px`, "--dy": `${spark.dy}px` } as React.CSSProperties}
            />
          ))}
        </g>
        <SheetShine start={7.9} />
      </g>
    </svg>
  );
}

export function DraftingAnimation() {
  const cycle = useLoopKey(LOOP_MS);
  const plan = DEMO_PLANS[cycle % DEMO_PLANS.length];

  return (
    <div className="sp-stage relative w-[260px] sm:w-[300px]" aria-hidden="true">
      <style>{SHEET_KEYFRAMES + DRAFTING_KEYFRAMES}</style>

      <div className="sp-float relative">
        {/* Högen med färdiga blad */}
        <div className="absolute inset-0 translate-x-[-10px] translate-y-[8px] -rotate-[4deg] rounded-[4px] bg-[#f3efe9] shadow-[0_1px_2px_rgba(28,25,23,0.08),0_10px_24px_-12px_rgba(28,25,23,0.25)]" />
        <div className="absolute inset-0 translate-x-[-4px] translate-y-[4px] -rotate-[1.5deg] rounded-[4px] bg-[#f7f4ef] shadow-[0_1px_2px_rgba(28,25,23,0.08)]" />

        {/* The sheet just finished keeps its drawing (same key, so it is not remounted) and is
            laid on the pile underneath the new one. */}
        {cycle > 0 ? (
          <div key={cycle - 1} className="sp-sheet-leave absolute inset-0">
            <div className="absolute inset-0 rounded-[4px] shadow-[0_1px_2px_rgba(28,25,23,0.08),0_18px_40px_-12px_rgba(28,25,23,0.28)]" />
            <Sheet plan={DEMO_PLANS[(cycle - 1) % DEMO_PLANS.length]} planIndex={(cycle - 1) % DEMO_PLANS.length} />
          </div>
        ) : null}
        <div key={cycle} className="sp-sheet relative">
          <div className="absolute inset-0 rounded-[4px] shadow-[0_1px_2px_rgba(28,25,23,0.08),0_18px_40px_-12px_rgba(28,25,23,0.28)]" />
          <Sheet plan={plan} planIndex={cycle % DEMO_PLANS.length} />
        </div>
      </div>

      <p key={`caption-${cycle}`} className="sp-fade mt-6 text-center text-xs text-stone-400" style={at(0.4)}>
        Illustration · {plan.kind}
      </p>
    </div>
  );
}

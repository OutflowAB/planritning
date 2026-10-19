"use client";

import { useEffect, useRef, useState } from "react";

import {
  at,
  BEIGE,
  INK,
  PAPER,
  ROOMS,
  RoomLabels,
  SheetBranding,
  SheetShine,
  SheetStage,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  StaticPlan,
  WALLS,
} from "./sheet-parts";
import { useLoopKey, useReducedMotion } from "./use-loop-key";

/**
 * Förslag C — "Modellen". The plan rises into an architect's model: walls extrude, the view
 * tilts into an isometric angle and turns slowly, then folds back down flat and becomes the
 * finished sheet. Every frame is projected in JavaScript and drawn as plain SVG polygons —
 * no CSS 3D — so the lines stay vector-sharp throughout.
 */

const LOOP_MS = 11200;
const CENTER = { x: 105, y: 160 };
const WALL_HEIGHT = 24;

/** Furniture that rises a little with the walls. */
const BLOCKS = [
  { x: 115, y: 105, w: 61, h: 12, height: 9 },
  { x: 153, y: 192, w: 23, h: 24, height: 6 },
  { x: 36, y: 177, w: 32, h: 38, height: 4 },
];

type Point = { x: number; y: number };

const easeInOut = (value: number) =>
  value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** 0 → 1 over [from, to] seconds, eased. */
function phase(seconds: number, from: number, to: number) {
  return easeInOut(clamp01((seconds - from) / (to - from)));
}

/** How far into the model we are at a moment: tilt (0 flat … 1 isometric) and angle. */
function pose(seconds: number) {
  const up = phase(seconds, 0.9, 3.0);
  const down = phase(seconds, 5.6, 7.4);
  const tilt = up * (1 - down);
  const angle = -38 + 14 * phase(seconds, 1.4, 7.0);
  return { tilt, angle };
}

function project(point: Point, tilt: number, angleDeg: number): Point {
  const radians = (angleDeg * Math.PI) / 180;
  const dx = point.x - CENTER.x;
  const dy = point.y - CENTER.y;
  const rx = dx * Math.cos(radians) - dy * Math.sin(radians);
  const ry = (dx * Math.sin(radians) + dy * Math.cos(radians)) * 0.56;
  const iso = { x: CENTER.x + rx * 0.92, y: CENTER.y + 14 + ry * 0.92 };
  return {
    x: point.x + (iso.x - point.x) * tilt,
    y: point.y + (iso.y - point.y) * tilt,
  };
}

type Box = { corners: Point[]; height: number; top: string; lightTop?: boolean };

function wallBoxes(): Box[] {
  const walls = WALLS.map((wall) => {
    const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
    const d = { x: (wall.x2 - wall.x1) / length, y: (wall.y2 - wall.y1) / length };
    const n = { x: -d.y, y: d.x };
    const half = wall.width / 2;
    const start = { x: wall.x1 - d.x * half, y: wall.y1 - d.y * half };
    const end = { x: wall.x2 + d.x * half, y: wall.y2 + d.y * half };
    return {
      corners: [
        { x: start.x + n.x * half, y: start.y + n.y * half },
        { x: end.x + n.x * half, y: end.y + n.y * half },
        { x: end.x - n.x * half, y: end.y - n.y * half },
        { x: start.x - n.x * half, y: start.y - n.y * half },
      ],
      height: WALL_HEIGHT,
      top: INK,
    };
  });
  const blocks = BLOCKS.map((block) => ({
    corners: [
      { x: block.x, y: block.y },
      { x: block.x + block.w, y: block.y },
      { x: block.x + block.w, y: block.y + block.h },
      { x: block.x, y: block.y + block.h },
    ],
    height: block.height,
    top: "#f5f2ee",
    lightTop: true,
  }));
  return [...walls, ...blocks];
}

const BOXES = wallBoxes();

/** Light from the upper left; a face turned towards it is paler. */
function faceShade(a: Point, b: Point, angleDeg: number) {
  const radians = (angleDeg * Math.PI) / 180;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const length = Math.hypot(ex, ey) || 1;
  // Outward normal in plan space (corners run clockwise on screen), then into view space.
  const nx = ey / length;
  const ny = -ex / length;
  const vx = nx * Math.cos(radians) - ny * Math.sin(radians);
  const vy = nx * Math.sin(radians) + ny * Math.cos(radians);
  // Light comes from the upper left of the view.
  const light = clamp01(0.5 + 0.5 * (vx * -0.6 + vy * -0.8));
  const tone = Math.round(150 + light * 85);
  return `rgb(${tone}, ${tone - 4}, ${tone - 9})`;
}

function polygon(points: Point[]) {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function ModelFrame({ seconds }: { seconds: number }) {
  const { tilt, angle } = pose(seconds);
  const lift = (height: number) => height * tilt;

  // Painter's order by each box's nearest corner: a long front wall then comes after the
  // furniture inside it, which an average depth would get wrong.
  const ordered = BOXES.map((box) => {
    const base = box.corners.map((corner) => project(corner, tilt, angle));
    const depth = Math.max(...base.map((point) => point.y));
    return { box, base, depth };
  }).sort((a, b) => a.depth - b.depth);

  return (
    <g>
      <g fill="#f3eee8" stroke="#d6cfc6" strokeWidth="0.3">
        {ROOMS.map((room) => (
          <polygon
            key={`${room.x}-${room.y}`}
            points={polygon(
              [
                { x: room.x, y: room.y },
                { x: room.x + room.w, y: room.y },
                { x: room.x + room.w, y: room.y + room.h },
                { x: room.x, y: room.y + room.h },
              ].map((corner) => project(corner, tilt, angle)),
            )}
          />
        ))}
      </g>
      {ordered.map(({ box, base }, boxIndex) => {
        const height = lift(box.height);
        const top = base.map((point) => ({ x: point.x, y: point.y - height }));
        const faces = base
          .map((point, index) => {
            const next = (index + 1) % base.length;
            return {
              points: [point, base[next], top[next], top[index]],
              depth: (point.y + base[next].y) / 2,
              shade: faceShade(box.corners[index], box.corners[next], angle),
            };
          })
          .sort((a, b) => a.depth - b.depth);
        return (
          <g key={boxIndex}>
            {height > 0.2
              ? faces.map((face, index) => (
                  <polygon
                    key={index}
                    points={polygon(face.points)}
                    fill={face.shade}
                    stroke="rgba(28,25,23,0.35)"
                    strokeWidth="0.25"
                    strokeLinejoin="round"
                  />
                ))
              : null}
            <polygon
              points={polygon(top)}
              fill={box.top}
              stroke={box.lightTop ? INK : "none"}
              strokeWidth={box.lightTop ? 0.5 : 0}
            />
          </g>
        );
      })}
    </g>
  );
}

/** One loop: its own clock from mount, so the model and the CSS timelines start together. */
function ModelLoop({ reduceMotion }: { reduceMotion: boolean }) {
  const [seconds, setSeconds] = useState(reduceMotion ? 9 : 0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    let frame = 0;
    const tick = (now: number) => {
      startRef.current ??= now;
      setSeconds((now - startRef.current) / 1000);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [reduceMotion]);

  // The model hands over to the flat sheet once it has folded back down.
  const modelOpacity = 1 - clamp01((seconds - 7.3) / 0.4);

  return (
    <svg
      viewBox={`0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}`}
      shapeRendering="geometricPrecision"
      className="relative block h-auto w-full rounded-[4px]"
    >
      <defs>
        <clipPath id="sp-c-clip">
          <rect width={SHEET_WIDTH} height={SHEET_HEIGHT} rx="4" />
        </clipPath>
      </defs>
      <rect width={SHEET_WIDTH} height={SHEET_HEIGHT} rx="4" fill={PAPER} />

      <g className="sp-out" clipPath="url(#sp-c-clip)" style={at((LOOP_MS - 700) / 1000)}>
        <rect className="sp-wash" width={SHEET_WIDTH} height={SHEET_HEIGHT} fill={BEIGE} style={at(7.5)} />
        <rect
          className="sp-fade"
          x="9"
          y="9"
          width="192"
          height="279"
          fill="none"
          stroke={INK}
          strokeWidth="0.6"
          style={at(7.4)}
        />

        {modelOpacity > 0 ? (
          <g opacity={modelOpacity}>
            <ModelFrame seconds={seconds} />
          </g>
        ) : null}

        <g className="sp-fade" style={at(7.3)}>
          <StaticPlan />
        </g>
        <RoomLabels start={8.1} step={0.1} />
        <SheetBranding start={8.4} />
        <SheetShine start={9.4} />
      </g>
    </svg>
  );
}

export function ModelAnimation() {
  const cycle = useLoopKey(LOOP_MS);
  const reduceMotion = useReducedMotion();

  return (
    <SheetStage>
      <ModelLoop key={cycle} reduceMotion={reduceMotion} />
    </SheetStage>
  );
}

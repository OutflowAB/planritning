/**
 * Made-up homes for the drawing-board animation, one per loop, so the wait does not look like
 * the same clip on repeat. Sheet units (A4, 210 × 297). Decorative only.
 */

export type Line = { x1: number; y1: number; x2: number; y2: number };

export type DemoPlan = {
  /** What kind of home it is, shown as a caption while it is drawn. */
  kind: string;
  /** Outer wall as one closed path, traced by the pen. */
  outer: string;
  /** Bounding box of the outer wall, for the dimension lines. */
  box: { x: number; y: number; width: number; height: number };
  /** Dimension labels, as metres. */
  widthMetres: number;
  heightMetres: number;
  inner: Line[];
  windows: Line[];
  doors: string[];
  fixtures: string[];
  circles: { cx: number; cy: number; r: number }[];
  rooms: { name: string; x: number; y: number; area: number }[];
};

export const DEMO_PLANS: DemoPlan[] = [
  {
    kind: "Villa, 1 plan",
    outer: "M30 100 H180 V220 H30 Z",
    box: { x: 30, y: 100, width: 150, height: 120 },
    widthMetres: 12.4,
    heightMetres: 9.8,
    inner: [
      { x1: 110, y1: 100, x2: 110, y2: 148 },
      { x1: 110, y1: 164, x2: 110, y2: 172 },
      { x1: 30, y1: 172, x2: 78, y2: 172 },
      { x1: 100, y1: 172, x2: 180, y2: 172 },
      { x1: 148, y1: 172, x2: 148, y2: 220 },
    ],
    windows: [
      { x1: 50, y1: 100, x2: 82, y2: 100 },
      { x1: 128, y1: 100, x2: 162, y2: 100 },
      { x1: 180, y1: 184, x2: 180, y2: 208 },
      { x1: 30, y1: 120, x2: 30, y2: 152 },
    ],
    doors: [
      "M78 172 V150 A22 22 0 0 1 100 172",
      "M110 148 H124 A16 16 0 0 1 110 164",
      "M148 188 H162 A14 14 0 0 0 148 174",
    ],
    fixtures: [
      "M115 105 H176 V117 H115 Z",
      "M121 108 H134 V114 H121 Z",
      "M165 206 H177 V217 H165 Z",
      "M36 177 H68 V215 H36 Z",
      "M36 184.6 H68 M36 192.2 H68 M36 199.8 H68 M36 207.4 H68",
    ],
    circles: [{ cx: 156, cy: 111, r: 3.6 }],
    rooms: [
      { name: "VARDAGSRUM", x: 70, y: 138, area: 32 },
      { name: "KÖK", x: 145, y: 140, area: 21 },
      { name: "SOVRUM", x: 108, y: 197, area: 18 },
      { name: "BAD", x: 166, y: 195, area: 5 },
    ],
  },
  {
    kind: "Lägenhet, 3 rok",
    outer: "M25 105 H185 V175 H130 V215 H25 Z",
    box: { x: 25, y: 105, width: 160, height: 110 },
    widthMetres: 13.2,
    heightMetres: 8.6,
    inner: [
      { x1: 85, y1: 105, x2: 85, y2: 130 },
      { x1: 85, y1: 146, x2: 85, y2: 215 },
      { x1: 25, y1: 160, x2: 60, y2: 160 },
      { x1: 76, y1: 160, x2: 85, y2: 160 },
      { x1: 85, y1: 175, x2: 100, y2: 175 },
      { x1: 114, y1: 175, x2: 130, y2: 175 },
    ],
    windows: [
      { x1: 35, y1: 105, x2: 70, y2: 105 },
      { x1: 118, y1: 105, x2: 165, y2: 105 },
      { x1: 25, y1: 176, x2: 25, y2: 202 },
      { x1: 185, y1: 122, x2: 185, y2: 158 },
    ],
    doors: [
      "M85 146 H101 A16 16 0 0 0 85 130",
      "M60 160 V144 A16 16 0 0 1 76 160",
      "M114 175 V189 A14 14 0 0 1 100 175",
    ],
    fixtures: [
      "M140 109 H181 V120 H140 Z",
      "M118 140 H158 V150 H118 Z",
      "M114 192 H127 V212 H114 Z",
      "M29 196 H45 V212 H29 Z",
    ],
    circles: [
      { cx: 170, cy: 114.5, r: 3.4 },
      { cx: 91, cy: 208, r: 3.5 },
    ],
    rooms: [
      { name: "VARDAGSRUM", x: 55, y: 126, area: 24 },
      { name: "KÖK", x: 168, y: 137, area: 27 },
      { name: "SOVRUM", x: 62, y: 190, area: 15 },
      { name: "BAD", x: 104, y: 196, area: 4 },
    ],
  },
  {
    kind: "Radhus, entréplan",
    outer: "M22 95 H188 V225 H22 Z",
    box: { x: 22, y: 95, width: 166, height: 130 },
    widthMetres: 14.6,
    heightMetres: 10.2,
    inner: [
      { x1: 22, y1: 150, x2: 50, y2: 150 },
      { x1: 66, y1: 150, x2: 90, y2: 150 },
      { x1: 104, y1: 150, x2: 150, y2: 150 },
      { x1: 166, y1: 150, x2: 188, y2: 150 },
      { x1: 82, y1: 95, x2: 82, y2: 150 },
      { x1: 114, y1: 95, x2: 114, y2: 150 },
      { x1: 120, y1: 150, x2: 120, y2: 180 },
      { x1: 120, y1: 196, x2: 120, y2: 225 },
    ],
    windows: [
      { x1: 34, y1: 95, x2: 66, y2: 95 },
      { x1: 134, y1: 95, x2: 172, y2: 95 },
      { x1: 40, y1: 225, x2: 92, y2: 225 },
      { x1: 140, y1: 225, x2: 170, y2: 225 },
      { x1: 22, y1: 168, x2: 22, y2: 204 },
    ],
    doors: [
      "M50 150 V134 A16 16 0 0 1 66 150",
      "M104 150 V136 A14 14 0 0 0 90 150",
      "M150 150 V134 A16 16 0 0 1 166 150",
      "M120 180 H136 A16 16 0 0 1 120 196",
    ],
    fixtures: [
      "M26 99 H48 V124 H26 Z M26 105 H48",
      "M86 99 H110 V112 H86 Z",
      "M176 155 H184 V221 H176 Z",
      "M136 200 H162 V216 H136 Z",
      "M30 204 H78 V219 H30 Z M30 209 H78",
    ],
    circles: [
      { cx: 180, cy: 172, r: 2.8 },
      { cx: 107, cy: 129, r: 3 },
    ],
    rooms: [
      { name: "SOVRUM", x: 66, y: 116, area: 12 },
      { name: "BAD", x: 93, y: 123, area: 5 },
      { name: "SOVRUM", x: 151, y: 124, area: 14 },
      { name: "VARDAGSRUM", x: 70, y: 182, area: 35 },
      { name: "KÖK", x: 150, y: 176, area: 19 },
    ],
  },
];

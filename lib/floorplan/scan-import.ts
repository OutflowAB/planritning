import {
  createDefaultTransform,
  createObjectId,
  FLOORPLAN_DOCUMENT_VERSION,
  type FloorplanDocument,
  type FloorplanDocumentMeta,
  type FloorplanObject,
} from "@/lib/floorplan/types";
import { polygonArea } from "@/lib/floorplan/measure";
import { getSymbolById, uprightBox } from "@/lib/floorplan/symbol-library";
import { roomLabelFontSize, SM_EDITOR, SM_ICON_STROKE, SM_INK, SM_ROOM_LABEL_FONT } from "@/lib/sm-floorplan-layout";

type Point = [number, number];

/**
 * A scan flattened to a top-down plan, in metres: x grows to the right, y grows downward.
 * Doors and windows name the wall they sit in and how far along it they start, so nothing
 * has to be matched up by geometry here.
 */
export type ScanPlan = {
  version: 1;
  walls: ScanWall[];
  doors?: ScanOpening[];
  windows?: ScanOpening[];
  /** Passages without a door: the wall is left open and nothing is drawn in the gap. */
  openings?: ScanOpening[];
  rooms?: ScanRoom[];
  objects?: ScanObject[];
};

export type ScanWall = { start: Point; end: Point; thickness?: number };
/** An opening `width` metres long, starting `offset` metres from the wall's start. */
export type ScanOpening = { wall: number; offset: number; width: number };
/** `outline` is the floor polygon; with it the room gets an area. */
export type ScanRoom = { name: string; center: Point; outline?: Point[] };
/**
 * Something RoomPlan detected, by its category name (`toilet`, `bathtub`, `bed`…). `rotation`
 * is in degrees about its centre, measured like a wall's direction.
 */
export type ScanObject = {
  category: string;
  center: Point;
  width: number;
  depth: number;
  rotation?: number;
};

/**
 * The categories the house style draws: fixed fittings and stairs. Furniture (beds, sofas,
 * tables, chairs) is never on the plans, so it is left out on import.
 */
const FIXTURE_SYMBOLS: Record<string, string> = {
  toilet: "wc",
  bathtub: "badkar",
  sink: "diskho",
  stove: "spis",
  oven: "ugn",
  dishwasher: "diskmaskin",
  refrigerator: "kyl",
  washerDryer: "tvatt",
  // Not a RoomPlan category: what a small box of walls with no way in becomes (see cleanUpWalls).
  wardrobe: "garderob",
  // Not a RoomPlan category either: kitchen cabinets joined into one worktop (see mergeCounters).
  counter: "bankskiva",
};

/** Where the plan may be drawn on the canvas, in canvas pixels. */
export type DrawingSlot = {
  canvasWidth: number;
  canvasHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
};

const MAX_ITEMS = 1000;
const DEFAULT_WALL_THICKNESS = 0.15;
// Room for the plan to breathe inside the slot.
const SLOT_FILL = 0.9;
// Openings may overshoot a wall's end by this much (metres) before the scan counts as broken.
const OPENING_TOLERANCE = 0.05;

export type ParseScanResult = { ok: true; scan: ScanPlan } | { ok: false; message: string };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber);
}

/**
 * Doors, windows and symbols are drawn from the top-left corner of their outline and rotated
 * about it. This finds that corner from a known point and where that point sits inside the
 * unrotated outline.
 */
function cornerFor(angle: number, [px, py]: Point, localX: number, localY: number) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  return createDefaultTransform(px - (localX * cos - localY * sin), py - (localX * sin + localY * cos));
}

function wallLength(wall: ScanWall) {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
}

function list(value: unknown, label: string): { items: unknown[] } | { error: string } {
  if (value === undefined) return { items: [] };
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    return { error: `${label} måste vara en lista med högst ${MAX_ITEMS} rader.` };
  }
  return { items: value };
}

export const RAW_ROOMPLAN_MESSAGE =
  "Det här är RoomPlans råfil – välj den exporterade planfilen (utan -roomplan i namnet).";

/** Validates an uploaded scan. Everything in it comes from outside, so nothing is assumed. */
export function parseScanPlan(input: unknown): ParseScanResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, message: "Skanningen är inte ett JSON-objekt." };
  }
  const raw = input as Record<string, unknown>;
  // The scanner app shares RoomPlan's own export beside ours; it is easy to pick by mistake.
  const firstWall = Array.isArray(raw.walls) ? (raw.walls[0] as Record<string, unknown> | undefined) : undefined;
  if ("coreModel" in raw || (firstWall && "transform" in firstWall && "dimensions" in firstWall)) {
    return { ok: false, message: RAW_ROOMPLAN_MESSAGE };
  }
  if (raw.version !== 1) {
    return { ok: false, message: "Okänd skanningsversion (förväntade version 1)." };
  }

  const wallList = list(raw.walls, "Väggarna");
  if ("error" in wallList) return { ok: false, message: wallList.error };
  if (wallList.items.length === 0) {
    return { ok: false, message: "Skanningen innehåller inga väggar." };
  }

  const walls: ScanWall[] = [];
  for (const [index, item] of wallList.items.entries()) {
    const wall = item as Record<string, unknown>;
    if (!isPoint(wall?.start) || !isPoint(wall?.end)) {
      return { ok: false, message: `Vägg ${index + 1} saknar giltig start- eller slutpunkt.` };
    }
    const thickness = wall.thickness;
    if (thickness !== undefined && (!isFiniteNumber(thickness) || thickness <= 0 || thickness > 1)) {
      return { ok: false, message: `Vägg ${index + 1} har en ogiltig tjocklek.` };
    }
    const parsed: ScanWall = { start: wall.start, end: wall.end, thickness };
    if (wallLength(parsed) < 0.01) {
      return { ok: false, message: `Vägg ${index + 1} har ingen längd.` };
    }
    walls.push(parsed);
  }

  function parseOpenings(value: unknown, label: string): ScanOpening[] | string {
    const openingList = list(value, label);
    if ("error" in openingList) return openingList.error;
    const openings: ScanOpening[] = [];
    for (const [index, item] of openingList.items.entries()) {
      const opening = item as Record<string, unknown>;
      const wallIndex = opening?.wall;
      if (!Number.isInteger(wallIndex) || (wallIndex as number) < 0 || (wallIndex as number) >= walls.length) {
        return `${label} ${index + 1} pekar på en vägg som inte finns.`;
      }
      if (!isFiniteNumber(opening.offset) || !isFiniteNumber(opening.width) || opening.offset < 0 || opening.width <= 0) {
        return `${label} ${index + 1} har ogiltig position eller bredd.`;
      }
      if (opening.offset + opening.width > wallLength(walls[wallIndex as number]) + OPENING_TOLERANCE) {
        return `${label} ${index + 1} sträcker sig utanför sin vägg.`;
      }
      openings.push({ wall: wallIndex as number, offset: opening.offset, width: opening.width });
    }
    return openings;
  }

  const doors = parseOpenings(raw.doors, "Dörr");
  if (typeof doors === "string") return { ok: false, message: doors };
  const windows = parseOpenings(raw.windows, "Fönster");
  if (typeof windows === "string") return { ok: false, message: windows };
  const openings = parseOpenings(raw.openings, "Öppning");
  if (typeof openings === "string") return { ok: false, message: openings };

  const roomList = list(raw.rooms, "Rummen");
  if ("error" in roomList) return { ok: false, message: roomList.error };
  const rooms: ScanRoom[] = [];
  for (const [index, item] of roomList.items.entries()) {
    const room = item as Record<string, unknown>;
    const name = typeof room?.name === "string" ? room.name.trim() : "";
    if (!name || name.length > 60 || !isPoint(room.center)) {
      return { ok: false, message: `Rum ${index + 1} saknar namn eller mittpunkt.` };
    }
    const outline = room.outline;
    if (
      outline !== undefined &&
      (!Array.isArray(outline) || outline.length < 3 || outline.length > MAX_ITEMS || !outline.every(isPoint))
    ) {
      return { ok: false, message: `Rum ${index + 1} har en ogiltig golvyta.` };
    }
    rooms.push({ name, center: room.center, outline: outline as Point[] | undefined });
  }

  const objectList = list(raw.objects, "Objekten");
  if ("error" in objectList) return { ok: false, message: objectList.error };
  const objects: ScanObject[] = [];
  for (const [index, item] of objectList.items.entries()) {
    const object = item as Record<string, unknown>;
    const category = typeof object?.category === "string" ? object.category : "";
    const size = (value: unknown) => isFiniteNumber(value) && value > 0 && value <= 20;
    if (
      !category ||
      category.length > 40 ||
      !isPoint(object.center) ||
      !size(object.width) ||
      !size(object.depth) ||
      (object.rotation !== undefined && !isFiniteNumber(object.rotation))
    ) {
      return { ok: false, message: `Objekt ${index + 1} har ogiltig kategori, position eller storlek.` };
    }
    objects.push({
      category,
      center: object.center,
      width: object.width as number,
      depth: object.depth as number,
      rotation: object.rotation as number | undefined,
    });
  }

  return { ok: true, scan: { version: 1, walls, doors, windows, openings, rooms, objects } };
}

/** Merged, clamped [from, to] intervals along a wall where it has openings. */
function openingIntervals(openings: ScanOpening[], length: number): Array<[number, number]> {
  const sorted = openings
    .map((opening): [number, number] => [
      Math.max(0, opening.offset),
      Math.min(length, opening.offset + opening.width),
    ])
    .sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1]) {
      last[1] = Math.max(last[1], interval[1]);
    } else {
      merged.push([...interval]);
    }
  }
  return merged;
}

// A scan's axes follow how the phone was held, not the house, so its walls usually come in at
// some angle. Plans are drawn with the house square to the page.
const SNAP_DEGREES = 5;
const BATHROOM_NAME = /bad|wc|toalett|dusch/i;

/**
 * Turns the scan so its walls run along the page: finds the dominant wall direction (length-
 * weighted, folded to a quarter turn so walls at right angles agree), rotates everything by it,
 * then makes walls that are within a few degrees of straight exactly straight.
 */
export function alignToWalls(scan: ScanPlan): ScanPlan {
  let cos = 0;
  let sin = 0;
  for (const wall of scan.walls) {
    const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
    const length = wallLength(wall);
    cos += length * Math.cos(4 * angle);
    sin += length * Math.sin(4 * angle);
  }
  const turn = -Math.atan2(sin, cos) / 4;
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const rotate = ([x, y]: Point): Point => [x * c - y * s, x * s + y * c];
  const turnDegrees = (turn * 180) / Math.PI;

  return {
    ...scan,
    walls: scan.walls.map((wall) => straighten({ ...wall, start: rotate(wall.start), end: rotate(wall.end) })),
    rooms: scan.rooms?.map((room) => ({
      ...room,
      center: rotate(room.center),
      outline: room.outline?.map(rotate),
    })),
    objects: scan.objects?.map((object) => ({
      ...object,
      center: rotate(object.center),
      rotation: (object.rotation ?? 0) + turnDegrees,
    })),
  };
}

/** A wall within a few degrees of horizontal or vertical, made exactly so. */
function straighten(wall: ScanWall): ScanWall {
  const [x1, y1] = wall.start;
  const [x2, y2] = wall.end;
  const degrees = Math.abs((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);
  if (degrees < SNAP_DEGREES || degrees > 180 - SNAP_DEGREES) {
    const y = (y1 + y2) / 2;
    return { ...wall, start: [x1, y], end: [x2, y] };
  }
  if (Math.abs(degrees - 90) < SNAP_DEGREES) {
    const x = (x1 + x2) / 2;
    return { ...wall, start: [x, y1], end: [x, y2] };
  }
  return wall;
}

/** The symbol a scanned object is drawn as, if the house style draws it at all. */
function symbolFor(item: ScanObject, rooms: ScanRoom[]) {
  const room = nearestRoomName(rooms, item.center) ?? "";
  // RoomPlan has one "sink"; in a bathroom it is a washbasin, anywhere else the kitchen sink.
  if (item.category === "sink") return BATHROOM_NAME.test(room) ? "handfat" : "diskho";
  // "storage" is a wardrobe in a bedroom or hall and the cabinets under the worktop in a kitchen,
  // drawn as counters as the house style asks. Bathroom and laundry cabinets stay undrawn.
  if (item.category === "storage") {
    if (/kök/i.test(room)) return "bankskiva";
    return /bad|wc|tvätt/i.test(room) ? undefined : "garderob";
  }
  return FIXTURE_SYMBOLS[item.category];
}

// Kitchen cabinets closer than this along a wall make one worktop.
const COUNTER_GAP_METRES = 0.1;

/**
 * RoomPlan finds kitchen cabinets one by one, so a worktop comes back as boxes overlapping each
 * other. Cabinets side by side along the same wall are drawn as one counter; where a worktop turns
 * a corner the cabinets face different ways and stay two counters, so an L-shaped kitchen keeps
 * its shape. Cabinets standing at an angle are left as they are.
 */
function mergeCounters(cabinets: ScanObject[]): ScanObject[] {
  type Run = { along: number; min: Point; max: Point };
  const runs: Run[] = [];
  const askew: ScanObject[] = [];
  for (const cabinet of cabinets) {
    const degrees = cabinet.rotation ?? 0;
    const quarters = Math.round(degrees / 90);
    if (Math.abs(degrees - quarters * 90) > 10) {
      askew.push({ ...cabinet, category: "counter" });
      continue;
    }
    const along = Math.abs(quarters % 2);
    const half: Point = along === 0 ? [cabinet.width / 2, cabinet.depth / 2] : [cabinet.depth / 2, cabinet.width / 2];
    runs.push({
      along,
      min: [cabinet.center[0] - half[0], cabinet.center[1] - half[1]],
      max: [cabinet.center[0] + half[0], cabinet.center[1] + half[1]],
    });
  }

  const joins = (a: Run, b: Run) => {
    const across = 1 - a.along;
    return (
      a.along === b.along &&
      Math.min(a.max[across], b.max[across]) > Math.max(a.min[across], b.min[across]) &&
      Math.max(a.min[a.along], b.min[a.along]) - Math.min(a.max[a.along], b.max[a.along]) <= COUNTER_GAP_METRES
    );
  };
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      if (!joins(runs[i], runs[j])) continue;
      const [a, b] = [runs[i], runs[j]];
      runs[i] = {
        along: a.along,
        min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])],
        max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])],
      };
      runs.splice(j, 1);
      // The longer run may now reach cabinets already passed over.
      j = i;
    }
  }

  return [
    ...runs.map((run): ScanObject => ({
      category: "counter",
      center: [(run.min[0] + run.max[0]) / 2, (run.min[1] + run.max[1]) / 2],
      width: run.max[0] - run.min[0],
      depth: run.max[1] - run.min[1],
      rotation: 0,
    })),
    ...askew,
  ];
}

function insidePolygon([x, y]: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The room a point is in: the one whose floor outline contains it when outlines are known, else
 * the one with the nearest centre (RoomPlan gives only centres when a scan covers several rooms,
 * so near a boundary in a large home this can pick the neighbour).
 */
function nearestRoomName(rooms: ScanRoom[], [x, y]: Point) {
  const containing = rooms.find((room) => room.outline && insidePolygon([x, y], room.outline));
  if (containing) return containing.name;
  let best: { name: string; distance: number } | null = null;
  for (const room of rooms) {
    const distance = Math.hypot(room.center[0] - x, room.center[1] - y);
    if (!best || distance < best.distance) best = { name: room.name, distance };
  }
  return best?.name ?? null;
}

// Scanned walls that belong on one line come back a few centimetres apart, and their ends stop
// just short of the walls they meet. Nothing is built like that, so differences this small are
// scanning noise and are closed up.
const MERGE_METRES = 0.1;
const JOIN_METRES = 0.1;
// A box of walls this shallow, with no door into it, is a built-in wardrobe, not a room.
const WARDROBE_MAX_DEPTH = 0.85;
// Narrower than a wardrobe door, or shallower than a wardrobe: a pipe shaft, chimney breast or
// recess in the wall, left as scanned. A chimney the size of a wardrobe can still pass; it is one
// click to delete in the editor.
const WARDROBE_MIN_WIDTH = 0.6;
const WARDROBE_MIN_DEPTH = 0.4;
const WARDROBE_MAX_WIDTH = 3;

/** 0 for a wall running along x, 1 for one running along y, null for a diagonal one. */
function axisOf(wall: ScanWall): 0 | 1 | null {
  if (wall.start[1] === wall.end[1]) return 0;
  if (wall.start[0] === wall.end[0]) return 1;
  return null;
}

/**
 * Puts parallel walls a few centimetres apart on one line (their length-weighted average), makes
 * wall ends that nearly meet a crossing wall meet it, and turns small doorless boxes of walls into
 * wardrobes. Expects straightened walls (see alignToWalls).
 */
export function cleanUpWalls(scan: ScanPlan): ScanPlan {
  const walls = scan.walls.map((wall) => ({ ...wall, start: [...wall.start] as Point, end: [...wall.end] as Point }));

  for (const axis of [0, 1] as const) {
    const across = 1 - axis;
    const parallel = walls
      .filter((wall) => axisOf(wall) === axis)
      .sort((a, b) => a.start[across] - b.start[across]);
    let line: ScanWall[] = [];
    const settle = () => {
      const total = line.reduce((sum, wall) => sum + wallLength(wall), 0);
      const value = line.reduce((sum, wall) => sum + wall.start[across] * wallLength(wall), 0) / total;
      for (const wall of line) wall.start[across] = wall.end[across] = value;
      line = [];
    };
    for (const wall of parallel) {
      // Measured from the first wall on the line, so a stepped facade cannot chain into one line.
      if (line.length > 0 && wall.start[across] - line[0].start[across] > MERGE_METRES) settle();
      line.push(wall);
    }
    if (line.length > 0) settle();
  }

  for (const wall of walls) {
    const axis = axisOf(wall);
    if (axis === null) continue;
    const across = 1 - axis;
    for (const end of [wall.start, wall.end]) {
      let best = JOIN_METRES;
      for (const other of walls) {
        if (other === wall || axisOf(other) !== across) continue;
        const low = Math.min(other.start[across], other.end[across]) - JOIN_METRES;
        const high = Math.max(other.start[across], other.end[across]) + JOIN_METRES;
        const distance = Math.abs(end[axis] - other.start[axis]);
        if (end[across] >= low && end[across] <= high && distance < best) {
          best = distance;
          end[axis] = other.start[axis];
        }
      }
    }
  }

  return wardrobesFromWallBoxes({ ...scan, walls });
}

function wardrobesFromWallBoxes(scan: ScanPlan): ScanPlan {
  const { walls } = scan;
  const touches = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.03;
  const onWall = (wall: ScanWall, point: Point) => {
    const [x, y] = point;
    const [x1, y1] = wall.start;
    const [x2, y2] = wall.end;
    return (
      x >= Math.min(x1, x2) - 0.03 && x <= Math.max(x1, x2) + 0.03 &&
      y >= Math.min(y1, y2) - 0.03 && y <= Math.max(y1, y2) + 0.03
    );
  };
  const withOpenings = new Set(
    [...(scan.doors ?? []), ...(scan.windows ?? []), ...(scan.openings ?? [])].map((opening) => opening.wall),
  );
  const removed = new Set<number>();
  const wardrobes: ScanObject[] = [];
  const behind: ScanWall[] = [];

  walls.forEach((front, frontIndex) => {
    const axis = axisOf(front);
    const width = wallLength(front);
    if (axis === null || withOpenings.has(frontIndex) || removed.has(frontIndex)) return;
    if (width < WARDROBE_MIN_WIDTH || width > WARDROBE_MAX_WIDTH) return;

    // The two sides: short walls at right angles to the front, one at each of its ends.
    const across = 1 - axis;
    const ends = [front.start, front.end];
    const sides = ends.map((end) =>
      walls.findIndex(
        (wall, index) =>
          index !== frontIndex &&
          !withOpenings.has(index) &&
          !removed.has(index) &&
          axisOf(wall) === across &&
          wallLength(wall) <= WARDROBE_MAX_DEPTH &&
          (touches(wall.start, end) || touches(wall.end, end)),
      ),
    );
    if (sides.includes(-1) || sides[0] === sides[1]) return;

    // Both sides run the same way, about equally far, and end on a wall: the box is closed.
    const backs = sides.map((sideIndex, k) => {
      const side = walls[sideIndex];
      return touches(side.start, ends[k]) ? side.end : side.start;
    });
    const depths = backs.map((back, k) => back[across] - ends[k][across]);
    if (Math.sign(depths[0]) !== Math.sign(depths[1]) || Math.abs(depths[0] - depths[1]) > 0.15) return;
    if (Math.min(Math.abs(depths[0]), Math.abs(depths[1])) < WARDROBE_MIN_DEPTH) return;
    const closed = backs.every((back) =>
      walls.some((wall, index) => index !== frontIndex && !sides.includes(index) && onWall(wall, back)),
    );
    if (!closed) return;

    removed.add(frontIndex);
    sides.forEach((index) => removed.add(index));
    // When the box stands out from a gap between two walls rather than against one, its back is
    // the line between them: draw it, or removing the box leaves a hole.
    const backWall = walls.find(
      (wall, index) => index !== frontIndex && !sides.includes(index) && backs.every((back) => onWall(wall, back)),
    );
    if (!backWall) behind.push({ start: backs[0], end: backs[1] });
    const xs = [...ends, ...backs].map((point) => point[0]);
    const ys = [...ends, ...backs].map((point) => point[1]);
    const center: Point = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const size: Point = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    // The box is measured to the back wall's centre line: stop at its face instead.
    const inset = (backWall?.thickness ?? DEFAULT_WALL_THICKNESS) / 2;
    center[across] -= (Math.sign(depths[0]) * inset) / 2;
    size[across] -= inset;
    wardrobes.push({ category: "wardrobe", center, width: size[0], depth: size[1], rotation: 0 });
  });

  if (removed.size === 0) return scan;

  // Openings refer to walls by position, so they follow the walls that remain.
  const newIndex = new Map<number, number>();
  walls.forEach((_, index) => {
    if (!removed.has(index)) newIndex.set(index, newIndex.size);
  });
  const reindex = (openings: ScanOpening[] | undefined) =>
    openings?.flatMap((opening) => {
      const wall = newIndex.get(opening.wall);
      return wall === undefined ? [] : [{ ...opening, wall }];
    });

  return {
    ...scan,
    // New walls go last so openings' wall numbers stay right.
    walls: [...walls.filter((_, index) => !removed.has(index)), ...behind],
    doors: reindex(scan.doors),
    windows: reindex(scan.windows),
    openings: reindex(scan.openings),
    objects: [...(scan.objects ?? []), ...wardrobes],
  };
}

/**
 * Turns a scan into an editor document on the blank canvas. The scale is chosen so the whole
 * plan fits the drawing slot, and kept on the document so lengths and areas can be measured.
 */
export function scanToFloorplanDocument(
  input: ScanPlan,
  slot: DrawingSlot,
  meta: FloorplanDocumentMeta,
): FloorplanDocument {
  const scan = cleanUpWalls(alignToWalls(input));
  // Fitted by the walls and every door's swing on both sides of its wall, so a door opening
  // outward (or flipped later) stays on the page.
  const swings = (scan.doors ?? []).flatMap((door) => {
    const wall = scan.walls[door.wall];
    if (!wall) return [];
    const length = wallLength(wall);
    const [ux, uy] = [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
    return [door.offset, door.offset + door.width].flatMap((distance) =>
      [-door.width, door.width].map((side): Point => [
        wall.start[0] + ux * distance - uy * side,
        wall.start[1] + uy * distance + ux * side,
      ]),
    );
  });
  const points = [...scan.walls.flatMap((wall) => [wall.start, wall.end]), ...swings];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(Math.max(...xs) - minX, 0.5);
  const spanY = Math.max(Math.max(...ys) - minY, 0.5);

  const pxPerMeter = Math.min(
    (slot.imageWidth * SLOT_FILL) / spanX,
    (slot.imageHeight * SLOT_FILL) / spanY,
  );
  const offsetX = slot.imageX + (slot.imageWidth - spanX * pxPerMeter) / 2 - minX * pxPerMeter;
  const offsetY = slot.imageY + (slot.imageHeight - spanY * pxPerMeter) / 2 - minY * pxPerMeter;
  const toCanvas = ([x, y]: Point): Point => [offsetX + x * pxPerMeter, offsetY + y * pxPerMeter];

  const objects: FloorplanObject[] = [];
  const doors = scan.doors ?? [];
  const windows = scan.windows ?? [];
  const passages = scan.openings ?? [];

  scan.walls.forEach((wall, wallIndex) => {
    const length = wallLength(wall);
    const ux = (wall.end[0] - wall.start[0]) / length;
    const uy = (wall.end[1] - wall.start[1]) / length;
    const along = (distance: number): Point =>
      toCanvas([wall.start[0] + ux * distance, wall.start[1] + uy * distance]);
    const thicknessPx = (wall.thickness ?? DEFAULT_WALL_THICKNESS) * pxPerMeter;
    const wallId = createObjectId();

    // The wall is drawn in pieces around its openings, so doorways and windows stay open.
    const openings = [...doors, ...windows, ...passages].filter((opening) => opening.wall === wallIndex);
    let cursor = 0;
    for (const [from, to] of [...openingIntervals(openings, length), [length, length] as [number, number]]) {
      if (from - cursor > 0.001) {
        let [x, y] = along(cursor);
        let [x2, y2] = along(from);
        // The editor positions a wall by its top-left end, so it must start at the smaller x.
        if (x2 < x || (x2 === x && y2 < y)) {
          [x, y, x2, y2] = [x2, y2, x, y];
        }
        // ...and by the corner of its stroke, not its centre line: shift so the line lands
        // where the scan put it.
        const strokeWidth = Math.max(SM_EDITOR.wallStroke, thicknessPx);
        const half = strokeWidth / 2;
        objects.push({
          id: createObjectId(),
          type: "wall",
          ...createDefaultTransform(x - half, y - half),
          x2: x2 - half,
          y2: y2 - half,
          strokeWidth,
          wallId,
        });
      }
      cursor = Math.max(cursor, to);
    }

    const angle = Math.atan2(uy, ux);
    const degrees = (angle * 180) / Math.PI;
    const corner = (point: Point, localX: number, localY: number) => cornerFor(angle, point, localX, localY);

    for (const door of doors.filter((opening) => opening.wall === wallIndex)) {
      const width = door.width * pxPerMeter;
      const half = SM_ICON_STROKE / 2;
      objects.push({
        id: createObjectId(),
        type: "door",
        // The hinge is the bottom-left of the door's outline; the leaf swings to the left of
        // the wall's direction.
        ...corner(along(door.offset), half, width + half),
        rotation: degrees,
        width,
        swing: "right",
        strokeWidth: SM_ICON_STROKE,
        wallId,
      });
    }

    for (const opening of windows.filter((candidate) => candidate.wall === wallIndex)) {
      const height = Math.max(thicknessPx, 6);
      // Windows have a 1 px frame.
      objects.push({
        id: createObjectId(),
        type: "window",
        ...corner(along(opening.offset), 0.5, height / 2 + 0.5),
        rotation: degrees,
        width: opening.width * pxPerMeter,
        height,
        strokeWidth: SM_EDITOR.dimensionStroke,
        wallId,
      });
    }
  });

  const rooms = scan.rooms ?? [];
  const isCabinet = (item: ScanObject) => symbolFor(item, rooms) === "bankskiva";
  // Counters first, so the hob and sink are drawn over them.
  const items = [
    ...mergeCounters((scan.objects ?? []).filter(isCabinet)),
    ...(scan.objects ?? []).filter((item) => !isCabinet(item)),
  ];
  const stoves = items.filter((item) => item.category === "stove");
  for (const item of items) {
    // A cooker comes back as a hob and the oven under it, in one place: the hob is what is drawn.
    const underHob = stoves.some(
      (stove) => Math.hypot(stove.center[0] - item.center[0], stove.center[1] - item.center[1]) < 0.3,
    );
    if (item.category === "oven" && underHob) continue;
    const width = item.width * pxPerMeter;
    const depth = item.depth * pxPerMeter;
    const degrees = item.rotation ?? 0;
    const placement = cornerFor((degrees * Math.PI) / 180, toCanvas(item.center), width / 2, depth / 2);

    if (item.category === "stairs") {
      objects.push({
        id: createObjectId(),
        type: "stair",
        ...placement,
        rotation: degrees,
        width,
        height: depth,
        direction: "up",
        strokeWidth: SM_ICON_STROKE,
      });
      continue;
    }

    const symbolId = symbolFor(item, rooms);
    if (!symbolId || !getSymbolById(symbolId)) {
      continue;
    }
    // An abbreviation box swaps sides instead of turning, so its letters stay level.
    const box = getSymbolById(symbolId)?.text
      ? uprightBox(width, depth, degrees)
      : { width, height: depth, rotation: degrees };
    objects.push({
      id: createObjectId(),
      type: "symbol",
      ...cornerFor((box.rotation * Math.PI) / 180, toCanvas(item.center), box.width / 2, box.height / 2),
      rotation: box.rotation,
      symbolId,
      width: box.width,
      height: box.height,
      fill: "transparent",
      stroke: SM_INK,
    });
  }

  const fontSize = roomLabelFontSize(slot.canvasWidth);
  for (const room of scan.rooms ?? []) {
    const [cx, cy] = toCanvas(room.center);
    // The house style writes room names in capitals.
    const text = room.name.toLocaleUpperCase("sv-SE");
    // Labels are placed by their top-left corner; this roughly centres the capitals.
    const estimatedWidth = text.length * fontSize * 0.65;
    objects.push({
      id: createObjectId(),
      type: "roomLabel",
      ...createDefaultTransform(cx - estimatedWidth / 2, cy - fontSize / 2),
      text,
      fontSize,
      fontFamily: SM_ROOM_LABEL_FONT,
      fill: SM_INK,
      textAlign: "center",
      ...(room.outline ? { areaM2: polygonArea(room.outline) } : {}),
    });
  }

  return {
    version: FLOORPLAN_DOCUMENT_VERSION,
    canvas: { width: slot.canvasWidth, height: slot.canvasHeight },
    meta,
    scale: { pxPerMeter },
    drawingArea: { x: slot.imageX, y: slot.imageY, width: slot.imageWidth, height: slot.imageHeight },
    objects,
  };
}

import sharp from "sharp";

import { chooseDoorSwings, sectorPath, type SwingChoice } from "@/lib/polycam/door-swing";
import { PolycamError } from "@/lib/polycam/fetch-roomplan";
import type {
  PlanAlignment,
  PlanElement,
  PlanOpening,
  PlanPoint,
  PlanRoom,
  PlanWall,
  RoomplanModel,
} from "@/lib/polycam/parse-roomplan";

/**
 * Draws a RoomPlan model as a plain top-down plan: black walls on white, gaps for doors and
 * openings, outlined white insets for windows, thin swing arcs for doors. No text and no
 * furniture — this image is the input to the AI step, and anything printed on it (English
 * room labels, for one) would be copied into the finished plan.
 */

/** Matches the width prepareSourceImage works at, so nothing is resampled on the way in. */
export const PLAN_LONG_EDGE_PX = 2560;
const MARGIN_RATIO = 0.06;

/**
 * RoomPlan reports tiny stub walls where two walls nearly meet (0.2 m in the sample). Drawn,
 * they read as a stray tick in the middle of a room; real wall returns are longer than this.
 */
export const MIN_WALL_LENGTH_M = 0.3;

/**
 * Lower than this is a railing or a half wall (the sample's balcony rail is 0.87 m). It is
 * kept, as a thin line, because the house style draws balconies with a thin outline rather
 * than a solid wall — and dropping it would leave the balcony open on one side.
 */
export const RAILING_MAX_HEIGHT_M = 1.0;
const RAILING_THICKNESS_RATIO = 0.35;

/**
 * RoomPlan reports every wall as 0.1 m thick. The house style needs exterior walls visibly
 * heavier, so a wall with no room on one side is drawn at this multiple, grown outwards so
 * the rooms keep their size.
 */
const EXTERIOR_THICKNESS_RATIO = 2.2;
/** How far beside a wall to look for a room when deciding whether it is exterior. */
const EXTERIOR_PROBE_M = 0.3;
/** Wall ends closer than this are treated as meeting in a corner. */
const CORNER_SNAP_M = 0.35;

/** Cut a little wider than the wall so no sliver of black survives at the edges. */
const OPENING_CUT_RATIO = 1.6;

const WHITE = "#FFFFFF";
const BLACK = "#000000";

export type RenderedPlan = {
  png: Buffer;
  width: number;
  height: number;
  /** The story that was drawn, and how many the scan has. */
  story: number;
  storyCount: number;
  wallCount: number;
  exteriorWallCount: number;
  droppedShortWalls: number;
};

type Vec = PlanPoint;

const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, z: a.z + b.z * k });
const normalOf = (along: Vec): Vec => ({ x: -along.z, z: along.x });

function aligner(alignment: PlanAlignment | null) {
  const a = alignment ?? { t00: 1, t02: 0, t03: 0, t20: 0, t22: 1, t23: 0 };
  return {
    point: (p: Vec): Vec => ({
      x: a.t00 * p.x + a.t02 * p.z + a.t03,
      z: a.t20 * p.x + a.t22 * p.z + a.t23,
    }),
    direction: (d: Vec): Vec => {
      const x = a.t00 * d.x + a.t02 * d.z;
      const z = a.t20 * d.x + a.t22 * d.z;
      const length = Math.hypot(x, z) || 1;
      return { x: x / length, z: z / length };
    },
  };
}

/** Corners of a rectangle centred on `centre`, `length` along `along` and `width` across. */
function rectangle(centre: Vec, along: Vec, length: number, width: number): Vec[] {
  const normal = normalOf(along);
  const a = length / 2;
  const b = width / 2;
  return [
    add(add(centre, along, -a), normal, -b),
    add(add(centre, along, a), normal, -b),
    add(add(centre, along, a), normal, b),
    add(add(centre, along, -a), normal, b),
  ];
}

function insidePolygon(point: Vec, polygon: Vec[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (
      pi.z > point.z !== pj.z > point.z &&
      point.x < ((pj.x - pi.x) * (point.z - pi.z)) / (pj.z - pi.z) + pi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

type DrawnWall = {
  id: string | null;
  centre: Vec;
  along: Vec;
  length: number;
  thickness: number;
  railing: boolean;
  exterior: boolean;
  /** Thickness before an exterior wall was thickened. */
  baseThickness: number;
  /** Centre before an exterior wall was moved outwards. */
  centreline: Vec;
  /** How far the wall was moved along its normal when it was thickened outwards. */
  shift: number;
  /** How far the drawn wall reaches past each end, to close the corners. */
  extendStart: number;
  extendEnd: number;
};

/**
 * Which side of a wall, if any, faces outdoors. Room polygons from RoomPlan overlap and have
 * notches, so the wall is probed at three points along its length and the majority decides.
 * Returns +1/-1 for the side along the normal that is outside, or 0 for an interior wall.
 */
function outsideSide(wall: DrawnWall, rooms: Vec[][]): -1 | 0 | 1 {
  if (rooms.length === 0) {
    return 0;
  }

  const normal = normalOf(wall.along);
  const offset = wall.thickness / 2 + EXTERIOR_PROBE_M;
  let plusOutside = 0;
  let minusOutside = 0;

  for (const fraction of [-0.3, 0, 0.3]) {
    const base = add(wall.centre, wall.along, fraction * wall.length);
    const plus = add(base, normal, offset);
    const minus = add(base, normal, -offset);
    if (!rooms.some((room) => insidePolygon(plus, room))) plusOutside += 1;
    if (!rooms.some((room) => insidePolygon(minus, room))) minusOutside += 1;
  }

  const plusIsOutside = plusOutside >= 2;
  const minusIsOutside = minusOutside >= 2;
  if (plusIsOutside === minusIsOutside) {
    // Rooms on both sides, or on neither (a stray wall): either way, not a clear façade.
    return 0;
  }
  return plusIsOutside ? 1 : -1;
}

/** The wall's rectangle, reaching past each end by its own extension. */
export function wallOutline(wall: DrawnWall): Vec[] {
  const centre = add(wall.centre, wall.along, (wall.extendEnd - wall.extendStart) / 2);
  return rectangle(centre, wall.along, wall.length + wall.extendStart + wall.extendEnd, wall.thickness);
}

/**
 * Every wall reaches half its own thickness past each end, which closes an ordinary corner.
 * A thickened exterior wall sits further out, so where two of them meet at an outside corner
 * each has to reach the other's outer face instead, or the corner is left notched. Only
 * outside corners get the long reach: at an inside corner or a T-junction it would poke into
 * the room.
 */
function closeExteriorCorners(walls: DrawnWall[]) {
  const ends = walls.flatMap((wall) =>
    wall.exterior
      ? ([-1, 1] as const).map((sign) => ({
          wall,
          sign,
          point: add(wall.centreline, wall.along, (sign * wall.length) / 2),
        }))
      : [],
  );

  for (const end of ends) {
    const outward = normalOf(end.wall.along);
    const outwardSign = Math.sign(end.wall.shift);
    for (const other of ends) {
      if (
        other.wall === end.wall ||
        Math.hypot(other.point.x - end.point.x, other.point.z - end.point.z) > CORNER_SNAP_M
      ) {
        continue;
      }
      // The direction the other wall runs away from the shared corner. If it heads into the
      // building side of this wall, the corner points outwards.
      const away = { x: -other.wall.along.x * other.sign, z: -other.wall.along.z * other.sign };
      const intoOutside = (away.x * outward.x + away.z * outward.z) * outwardSign;
      if (intoOutside < 0) {
        const reach = other.wall.thickness - other.wall.baseThickness / 2;
        if (end.sign > 0) {
          end.wall.extendEnd = Math.max(end.wall.extendEnd, reach);
        } else {
          end.wall.extendStart = Math.max(end.wall.extendStart, reach);
        }
      }
    }
  }
}

function storiesOf(model: RoomplanModel) {
  return [...new Set(model.walls.map((wall) => wall.story))].sort((a, b) => a - b);
}

/** A storey the user can choose: counts and floor area only, no guesses about what it is. */
export type StoreySummary = { story: number; wallCount: number; roomCount: number; areaM2: number };

function polygonArea(vertices: Vec[]) {
  let twice = 0;
  vertices.forEach((p, i) => {
    const q = vertices[(i + 1) % vertices.length];
    twice += p.x * q.z - q.x * p.z;
  });
  return Math.abs(twice) / 2;
}

/** Storeys that have walls, lowest first. Cheap: reads the parsed file, draws nothing. */
export function listStoreys(model: RoomplanModel): StoreySummary[] {
  return storiesOf(model).map((story) => {
    const rooms = model.rooms.filter((room) => room.story === story);
    return {
      story,
      wallCount: model.walls.filter((wall) => wall.story === story).length,
      roomCount: rooms.length,
      areaM2: Math.round(rooms.reduce((sum, room) => sum + polygonArea(room.vertices), 0)),
    };
  });
}

function pickStory(model: RoomplanModel, requested?: number) {
  const stories = storiesOf(model);
  if (requested !== undefined && !stories.includes(requested)) {
    throw new PolycamError("missing", "Den valda våningen finns inte i skanningen.");
  }
  return { story: requested ?? stories[0] ?? 0, storyCount: stories.length };
}

function noWalls(): never {
  throw new PolycamError("missing", "Skanningen innehåller inga väggar som går att rita.");
}

/**
 * Everything the drawing is made of, in plan coordinates. Split from the SVG step so the door
 * swings can be checked against the walls without rasterising anything.
 */
export function preparePlan(model: RoomplanModel, requestedStory?: number) {
  const { story, storyCount } = pickStory(model, requestedStory);
  const align = aligner(model.alignment);
  const onStory = <T extends PlanElement | PlanRoom>(item: T) => item.story === story;

  const candidateWalls = model.walls.filter(onStory);
  const keptWalls = candidateWalls.filter((wall) => wall.length >= MIN_WALL_LENGTH_M);
  if (keptWalls.length === 0) {
    noWalls();
  }

  const rooms = model.rooms.filter(onStory).map((room) => room.vertices.map(align.point));

  const walls: DrawnWall[] = keptWalls.map((wall: PlanWall) => {
    const railing = wall.height < RAILING_MAX_HEIGHT_M;
    const thickness = railing ? wall.thickness * RAILING_THICKNESS_RATIO : wall.thickness;
    const centre = align.point(wall.centre);
    return {
      id: wall.id,
      centre,
      centreline: centre,
      along: align.direction(wall.along),
      length: wall.length,
      thickness,
      baseThickness: thickness,
      railing,
      exterior: false,
      shift: 0,
      extendStart: thickness / 2,
      extendEnd: thickness / 2,
    };
  });

  for (const wall of walls) {
    if (wall.railing) {
      continue;
    }
    const side = outsideSide(wall, rooms);
    if (side !== 0) {
      const grown = wall.thickness * EXTERIOR_THICKNESS_RATIO;
      wall.shift = (side * (grown - wall.thickness)) / 2;
      wall.centre = add(wall.centre, normalOf(wall.along), wall.shift);
      wall.thickness = grown;
      wall.exterior = true;
    }
  }

  closeExteriorCorners(walls);

  const wallsById = new Map(walls.filter((wall) => wall.id).map((wall) => [wall.id, wall]));
  const widestWall = Math.max(...walls.map((wall) => wall.thickness));

  const openings = model.openings.filter(onStory).map((opening: PlanOpening) => {
    const along = align.direction(opening.along);
    let centre = align.point(opening.centre);
    const parent = opening.parentWallId ? wallsById.get(opening.parentWallId) : undefined;
    // An exterior wall was moved outwards when it was thickened; the opening has to follow
    // it, or the cut lands half in the room.
    if (parent) {
      centre = add(centre, normalOf(parent.along), parent.shift);
    }
    return {
      kind: opening.kind,
      centre,
      along,
      length: opening.length,
      wallThickness: parent?.thickness ?? widestWall,
      parentWallId: opening.parentWallId,
      swingHint: opening.swing,
      swing: null as SwingChoice | null,
    };
  });

  // Doors are placed against the finished walls, after thickening, since a swing has to clear
  // the walls as drawn rather than as scanned.
  const doors = openings.filter((opening) => opening.kind === "door");
  const choices = chooseDoorSwings(
    doors.map((door) => ({ ...door, hint: door.swingHint })),
    walls.map((wall) => ({ id: wall.id, outline: wallOutline(wall) })),
    rooms,
  );
  doors.forEach((door, index) => {
    door.swing = choices[index];
  });

  return { story, storyCount, droppedShortWalls: candidateWalls.length - keptWalls.length, walls, openings, rooms };
}

/** Draws one storey: the one asked for, or the lowest when none is given. */
export async function renderPlan(model: RoomplanModel, options: { story?: number } = {}): Promise<RenderedPlan> {
  const { story, storyCount, droppedShortWalls, walls, openings } = preparePlan(model, options.story);

  // Fit the drawing: the bounding box of everything drawn, including the door swings.
  const outline: Vec[] = walls.flatMap(wallOutline);
  for (const opening of openings) {
    outline.push(...rectangle(opening.centre, opening.along, opening.length, opening.wallThickness));
    if (opening.swing) outline.push(...sectorPath(opening.swing.sector));
  }

  // A loop: spreading a large outline into Math.min/max overflows the call stack.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  if (Math.max(spanX, spanZ) < 0.5) {
    noWalls();
  }

  const margin = Math.round(PLAN_LONG_EDGE_PX * MARGIN_RATIO);
  const scale = (PLAN_LONG_EDGE_PX - 2 * margin) / Math.max(spanX, spanZ);
  const width = Math.max(1, Math.round(spanX * scale) + 2 * margin);
  const height = Math.max(1, Math.round(spanZ * scale) + 2 * margin);
  // Image y is world z: seen from above with Y up, +X is right and +Z is down, so this is not
  // a mirror image.
  const toPx = (p: Vec) =>
    `${((p.x - minX) * scale + margin).toFixed(1)},${((p.z - minZ) * scale + margin).toFixed(1)}`;
  const polygon = (points: Vec[], attributes: string) =>
    `<polygon points="${points.map(toPx).join(" ")}" ${attributes}/>`;
  const thinLine = Math.max(2, Math.round(scale * 0.015));

  const parts: string[] = [`<rect width="100%" height="100%" fill="${WHITE}"/>`];

  for (const wall of walls) {
    parts.push(polygon(wallOutline(wall), `fill="${BLACK}"`));
  }

  for (const opening of openings) {
    parts.push(
      polygon(
        rectangle(opening.centre, opening.along, opening.length, opening.wallThickness * OPENING_CUT_RATIO),
        `fill="${WHITE}"`,
      ),
    );
  }

  for (const opening of openings) {
    if (opening.kind === "window") {
      parts.push(
        polygon(
          rectangle(opening.centre, opening.along, opening.length, opening.wallThickness),
          `fill="${WHITE}" stroke="${BLACK}" stroke-width="${thinLine}"`,
        ),
      );
    } else if (opening.swing) {
      parts.push(
        `<polyline points="${sectorPath(opening.swing.sector).map(toPx).join(" ")}" fill="none" stroke="${BLACK}" stroke-width="${thinLine}" stroke-linejoin="round"/>`,
      );
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
  const png = await sharp(Buffer.from(svg))
    .flatten({ background: WHITE })
    .png()
    .toBuffer();

  return {
    png,
    width,
    height,
    story,
    storyCount,
    wallCount: walls.length,
    exteriorWallCount: walls.filter((wall) => wall.exterior).length,
    droppedShortWalls,
  };
}

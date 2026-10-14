import { PolycamError } from "@/lib/polycam/fetch-roomplan";

/**
 * Turns a downloaded `optimized_roomplan.json` (Apple RoomPlan, as exported by Polycam) into
 * the little the plan renderer needs, and nothing else.
 *
 * The file is untrusted input from a third party. Every field is checked by hand, sizes are
 * capped, and anything not listed in the model below is dropped — including `latLonAlt`, the
 * scan's GPS position, which is never read at all.
 *
 * Coordinates stay in RoomPlan's world frame: metres, Y up, so the plan is the X/Z plane.
 */

export type PlanPoint = { x: number; z: number };

/** A wall, door, window or opening: a rectangle standing on the floor. */
export type PlanElement = {
  /** Centre on the floor plane. */
  centre: PlanPoint;
  /** Unit vector along the element's length. */
  along: PlanPoint;
  length: number;
  height: number;
  thickness: number;
  story: number;
};

export type PlanWall = PlanElement & { id: string | null };

export type OpeningKind = "door" | "window" | "opening";

/** RoomPlan's hinge side (left/right) and which face of the wall the leaf swings towards. */
export type DoorSwing = "left_p1" | "left_p2" | "right_p1" | "right_p2";

export type PlanOpening = PlanElement & {
  kind: OpeningKind;
  parentWallId: string | null;
  swing: DoorSwing | null;
};

export type PlanRoom = { vertices: PlanPoint[]; story: number };

/**
 * The part of `alignment_transform` that acts on the floor plane. RoomPlan's world axes are
 * wherever the phone started; this rotation squares the walls up with the image axes.
 */
export type PlanAlignment = {
  t00: number;
  t02: number;
  t03: number;
  t20: number;
  t22: number;
  t23: number;
};

export type RoomplanModel = {
  walls: PlanWall[];
  openings: PlanOpening[];
  rooms: PlanRoom[];
  alignment: PlanAlignment | null;
  /** Compass bearing of the scan, when RoomPlan recorded one. Not used for drawing yet. */
  orientationDegrees: number | null;
  /** Elements that were present but malformed and therefore left out. */
  skipped: number;
};

/** Far beyond any real home (a 25-wall apartment is typical), small enough to stay cheap. */
export const MAX_ELEMENTS = 2000;
const MAX_ROOMS = 500;
const MAX_ROOM_VERTICES = 1000;

/** No dwelling is a kilometre across; larger values are corrupt and would wreck the scale. */
const MAX_COORDINATE_M = 1000;
const MAX_SIZE_M = 200;
const DEFAULT_WALL_THICKNESS_M = 0.1;
const MAX_WALL_THICKNESS_M = 2;

function invalid(): never {
  throw new PolycamError("invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON cannot hold NaN, but 1e400 parses to Infinity, so finiteness still has to be checked. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalArray(root: Record<string, unknown>, key: string, max: number): unknown[] {
  const value = root[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > max) {
    invalid();
  }
  return value;
}

function readStory(value: unknown) {
  return Number.isInteger(value) && Math.abs(value as number) <= 100 ? (value as number) : 0;
}

function readIdentifier(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
}

/**
 * RoomPlan stores each element as a 4x4 column-major matrix plus [length, height, depth].
 * Translation is T[12..14]; the first column is the element's own X axis, i.e. along its
 * length. Returns null for anything malformed so one bad element does not sink the file.
 */
function readElement(value: unknown): (PlanElement & { raw: Record<string, unknown> }) | null {
  if (!isRecord(value)) {
    return null;
  }

  const { transform, dimensions } = value;
  if (
    !Array.isArray(transform) ||
    transform.length !== 16 ||
    !transform.every(isFiniteNumber) ||
    !Array.isArray(dimensions) ||
    dimensions.length < 2 ||
    !isFiniteNumber(dimensions[0]) ||
    !isFiniteNumber(dimensions[1])
  ) {
    return null;
  }

  const [ax, , az] = transform as number[];
  const centre = { x: transform[12] as number, z: transform[14] as number };
  const alongLength = Math.hypot(ax, az);
  const length = dimensions[0] as number;
  const height = dimensions[1] as number;

  if (
    alongLength < 1e-6 ||
    Math.abs(centre.x) > MAX_COORDINATE_M ||
    Math.abs(centre.z) > MAX_COORDINATE_M ||
    !(length > 0 && length <= MAX_SIZE_M) ||
    !(height >= 0 && height <= MAX_SIZE_M)
  ) {
    return null;
  }

  const thickness =
    isFiniteNumber(value.wall_thickness) &&
    value.wall_thickness > 0 &&
    value.wall_thickness <= MAX_WALL_THICKNESS_M
      ? value.wall_thickness
      : DEFAULT_WALL_THICKNESS_M;

  return {
    centre,
    along: { x: ax / alongLength, z: az / alongLength },
    length,
    height,
    thickness,
    story: readStory(value.story),
    raw: value,
  };
}

function readSwing(value: unknown): DoorSwing | null {
  return value === "left_p1" || value === "left_p2" || value === "right_p1" || value === "right_p2"
    ? value
    : null;
}

function readRoom(value: unknown): PlanRoom | null {
  if (!isRecord(value)) {
    return null;
  }

  const xs = value.vertices_x;
  const zs = value.vertices_z;
  if (
    !Array.isArray(xs) ||
    !Array.isArray(zs) ||
    xs.length !== zs.length ||
    xs.length < 3 ||
    xs.length > MAX_ROOM_VERTICES
  ) {
    return null;
  }

  const vertices: PlanPoint[] = [];
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index];
    const z = zs[index];
    if (
      !isFiniteNumber(x) ||
      !isFiniteNumber(z) ||
      Math.abs(x) > MAX_COORDINATE_M ||
      Math.abs(z) > MAX_COORDINATE_M
    ) {
      return null;
    }
    vertices.push({ x, z });
  }

  return { vertices, story: readStory(value.story) };
}

/**
 * Only a rotation (plus translation) is accepted. Anything that would scale or shear the plan
 * is ignored, since a stretched drawing is worse than a slightly tilted one.
 */
function readAlignment(value: unknown): PlanAlignment | null {
  if (!isRecord(value)) {
    return null;
  }

  const keys = ["t00", "t02", "t03", "t20", "t22", "t23"] as const;
  if (!keys.every((key) => isFiniteNumber(value[key]))) {
    return null;
  }

  const alignment = Object.fromEntries(keys.map((key) => [key, value[key]])) as PlanAlignment;
  const determinant = alignment.t00 * alignment.t22 - alignment.t02 * alignment.t20;
  const columnLength = Math.hypot(alignment.t00, alignment.t20);
  if (
    Math.abs(Math.abs(determinant) - 1) > 0.01 ||
    Math.abs(columnLength - 1) > 0.01 ||
    Math.abs(alignment.t03) > MAX_COORDINATE_M ||
    Math.abs(alignment.t23) > MAX_COORDINATE_M
  ) {
    return null;
  }

  return alignment;
}

export function parseRoomplan(data: unknown): RoomplanModel {
  if (!isRecord(data) || !Array.isArray(data.walls)) {
    invalid();
  }

  const rawWalls = optionalArray(data, "walls", MAX_ELEMENTS);
  const groups: [OpeningKind, unknown[]][] = [
    ["door", optionalArray(data, "doors", MAX_ELEMENTS)],
    ["window", optionalArray(data, "windows", MAX_ELEMENTS)],
    ["opening", optionalArray(data, "openings", MAX_ELEMENTS)],
  ];
  const rawRooms = optionalArray(data, "rooms", MAX_ROOMS);

  let skipped = 0;

  const walls: PlanWall[] = [];
  for (const rawWall of rawWalls) {
    const element = readElement(rawWall);
    if (!element) {
      skipped += 1;
      continue;
    }
    const { raw, ...wall } = element;
    walls.push({ ...wall, id: readIdentifier(raw.identifier) });
  }

  const openings: PlanOpening[] = [];
  for (const [kind, rawItems] of groups) {
    for (const rawItem of rawItems) {
      const element = readElement(rawItem);
      if (!element) {
        skipped += 1;
        continue;
      }
      const { raw, ...opening } = element;
      openings.push({
        ...opening,
        kind,
        parentWallId: readIdentifier(raw.parentIdentifier),
        swing: kind === "door" ? readSwing(raw.door_swing_dir) : null,
      });
    }
  }

  const rooms: PlanRoom[] = [];
  for (const rawRoom of rawRooms) {
    const room = readRoom(rawRoom);
    if (room) {
      rooms.push(room);
    } else {
      skipped += 1;
    }
  }

  const orientation = isRecord(data.orientation) ? data.orientation.orientation_degrees : null;

  return {
    walls,
    openings,
    rooms,
    alignment: readAlignment(data.alignment_transform),
    orientationDegrees: isFiniteNumber(orientation) ? orientation : null,
    skipped,
  };
}

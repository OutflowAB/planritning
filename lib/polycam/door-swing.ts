import type { DoorSwing, PlanPoint } from "@/lib/polycam/parse-roomplan";

/**
 * Chooses which way each door swings, from the geometry of the plan.
 *
 * RoomPlan's `door_swing_dir` is the only hint in the scan, and its left/right/p1/p2
 * convention is undocumented (and missing on some doors). Trusting it drew arcs through walls
 * and on top of each other, and the AI redraw copies whatever arc it is given. A real plan
 * never does that, so the arc is placed where it fits and the hint only breaks ties.
 */

type Vec = PlanPoint;

/** A quarter disc: the area a door leaf sweeps between "open" and "closed". */
export type Sector = {
  hinge: Vec;
  /** Unit directions of the two straight edges; perpendicular to each other. */
  open: Vec;
  closed: Vec;
  radius: number;
};

export type SwingDoor = {
  centre: Vec;
  along: Vec;
  length: number;
  parentWallId: string | null;
  hint: DoorSwing | null;
};

export type SwingObstacle = { id: string | null; outline: Vec[] };

export type SwingChoice = { hingeSign: -1 | 1; faceSign: -1 | 1; sector: Sector };

/**
 * Slack for contacts that are meant to touch: an open leaf lying along a wall, two sectors
 * sharing an edge, or a wall that is exactly one leaf-length away. Without it every door
 * beside a corner would count as blocked.
 */
const TOLERANCE_M = 0.06;
const ARC_STEPS = 24;
const OVERLAP_ARC_CHORDS = 12;

const normalOf = (along: Vec): Vec => ({ x: -along.z, z: along.x });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.z * b.z;
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, z: a.z - b.z });
const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, z: a.z + b.z * k });

export function sectorFor(door: Pick<SwingDoor, "centre" | "along" | "length">, hingeSign: -1 | 1, faceSign: -1 | 1): Sector {
  const normal = normalOf(door.along);
  return {
    hinge: add(door.centre, door.along, (hingeSign * door.length) / 2),
    open: { x: normal.x * faceSign, z: normal.z * faceSign },
    // The closed leaf lies in the opening, pointing from the hinge towards the other jamb.
    closed: { x: -door.along.x * hingeSign, z: -door.along.z * hingeSign },
    radius: door.length,
  };
}

/** The leaf and its arc as a polyline starting at the hinge, for drawing. */
export function sectorPath(sector: Sector): Vec[] {
  const path: Vec[] = [sector.hinge];
  for (let step = 0; step <= ARC_STEPS; step += 1) {
    const angle = (step / ARC_STEPS) * (Math.PI / 2);
    path.push(
      add(add(sector.hinge, sector.open, Math.cos(angle) * sector.radius), sector.closed, Math.sin(angle) * sector.radius),
    );
  }
  return path;
}

/**
 * Whether segment a-b enters the interior of the sector. The sector's own edges and arc do
 * not count (see TOLERANCE_M), so a wall merely touching it is not a hit.
 *
 * `open` and `closed` are perpendicular unit vectors, so in that basis the sector is the
 * quarter plane x, y >= 0 cut by a circle: clip the segment to the quarter plane (two linear
 * constraints), then ask whether the clipped piece comes closer to the hinge than the radius.
 */
export function sectorHitsSegment(sector: Sector, a: Vec, b: Vec): boolean {
  const pa = sub(a, sector.hinge);
  const pb = sub(b, sector.hinge);
  const x0 = dot(pa, sector.open);
  const x1 = dot(pb, sector.open);
  const y0 = dot(pa, sector.closed);
  const y1 = dot(pb, sector.closed);

  let lo = 0;
  let hi = 1;
  for (const [v0, v1] of [
    [x0, x1],
    [y0, y1],
  ]) {
    const slope = v1 - v0;
    if (slope === 0) {
      // Parallel to this edge (or a single point): either wholly inside or wholly outside.
      if (v0 < TOLERANCE_M) return false;
    } else {
      const t = (TOLERANCE_M - v0) / slope;
      if (slope > 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
    }
  }
  if (lo > hi) return false;

  // Closest point to the hinge on the clipped piece.
  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  const lengthSq = dx * dx + dz * dz;
  let t = lengthSq === 0 ? 0 : -(pa.x * dx + pa.z * dz) / lengthSq;
  t = Math.min(hi, Math.max(lo, t));
  const nearest = Math.hypot(pa.x + dx * t, pa.z + dz * t);
  return nearest < sector.radius - TOLERANCE_M;
}

function polygonEdges(polygon: Vec[]): [Vec, Vec][] {
  return polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]]);
}

/** Whether a polygon's boundary enters the sector. A thin wall inside it still has edges in it. */
export function sectorHitsPolygon(sector: Sector, polygon: Vec[]): boolean {
  return polygonEdges(polygon).some(([a, b]) => sectorHitsSegment(sector, a, b));
}

/** Points inside the sector, spread over radius and angle: stand-ins for "the floor it covers". */
function interiorSamples(sector: Sector): Vec[] {
  const samples: Vec[] = [];
  for (const fraction of [0.3, 0.6, 0.9]) {
    for (const degrees of [15, 45, 75]) {
      const angle = (degrees * Math.PI) / 180;
      samples.push(
        add(add(sector.hinge, sector.open, Math.cos(angle) * sector.radius * fraction), sector.closed, Math.sin(angle) * sector.radius * fraction),
      );
    }
  }
  return samples;
}

/** Two sectors overlap when the boundary of one enters the other, or one sits inside the other. */
export function sectorsOverlap(a: Sector, b: Sector): boolean {
  const boundary = (s: Sector): [Vec, Vec][] => {
    const arc = sectorPath(s).slice(1);
    const chords: [Vec, Vec][] = [];
    const stride = ARC_STEPS / OVERLAP_ARC_CHORDS;
    for (let i = 0; i + stride < arc.length; i += stride) chords.push([arc[i], arc[i + stride]]);
    return [[s.hinge, arc[0]], [s.hinge, arc[arc.length - 1]], ...chords];
  };
  const crosses = (from: Sector, into: Sector) =>
    boundary(from).some(([p, q]) => sectorHitsSegment(into, p, q)) ||
    // Equal or nested sectors have no boundary inside the other's interior, but their floor is.
    interiorSamples(from).some((p) => sectorHitsSegment(into, p, p));
  return crosses(a, b) || crosses(b, a);
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

/** Fixed candidate order, so a tie that survives every other rule is still deterministic. */
const CANDIDATES: { hingeSign: -1 | 1; faceSign: -1 | 1 }[] = [
  { hingeSign: -1, faceSign: 1 },
  { hingeSign: 1, faceSign: 1 },
  { hingeSign: -1, faceSign: -1 },
  { hingeSign: 1, faceSign: -1 },
];

function hintMatches(hint: DoorSwing | null, hingeSign: -1 | 1, faceSign: -1 | 1) {
  if (!hint) return true;
  return hint.startsWith("left") === (hingeSign === -1) && hint.endsWith("p2") === (faceSign === -1);
}

function isLower(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/**
 * One choice per door, in the order the doors were given; `null` means "draw the gap without
 * an arc". Doors are resolved widest first, then by position, so the result does not depend on
 * the order RoomPlan listed them in.
 *
 * Candidates are compared on, in order: walls the sector runs into, doors it overlaps, probe
 * points outside every room, and last the scan's hint. A door whose best candidate still hits
 * a wall or another door gets no arc: a wrong arc is copied into the finished plan as fact,
 * while a bare gap is merely read as an opening, which the user can fix in one stroke.
 */
export function chooseDoorSwings(doors: SwingDoor[], obstacles: SwingObstacle[], rooms: Vec[][]): (SwingChoice | null)[] {
  const order = doors
    .map((door, index) => ({ door, index }))
    .sort(
      (p, q) =>
        q.door.length - p.door.length ||
        p.door.centre.x - q.door.centre.x ||
        p.door.centre.z - q.door.centre.z ||
        p.index - q.index,
    );

  const result: (SwingChoice | null)[] = doors.map(() => null);
  const placed: Sector[] = [];

  for (const { door, index } of order) {
    // The parent wall is the wall the door sits in; if the scan does not name it, any wall
    // the opening's centre lies in is.
    const blockers = obstacles.filter(
      (wall) => !(wall.id !== null && wall.id === door.parentWallId) && !insidePolygon(door.centre, wall.outline),
    );

    let best: { choice: SwingChoice; score: number[] } | null = null;
    CANDIDATES.forEach(({ hingeSign, faceSign }, rank) => {
      const sector = sectorFor(door, hingeSign, faceSign);
      const wallHits = blockers.filter((wall) => sectorHitsPolygon(sector, wall.outline)).length;
      const doorHits = placed.filter((other) => sectorsOverlap(sector, other)).length;
      const outside =
        rooms.length === 0 ? 0 : interiorSamples(sector).filter((p) => !rooms.some((room) => insidePolygon(p, room))).length;
      const score = [wallHits, doorHits, outside, hintMatches(door.hint, hingeSign, faceSign) ? 0 : 1, rank];
      if (!best || isLower(score, best.score)) {
        best = { choice: { hingeSign, faceSign, sector }, score };
      }
    });

    const winner = best as { choice: SwingChoice; score: number[] } | null;
    if (winner && winner.score[0] === 0 && winner.score[1] === 0) {
      result[index] = winner.choice;
      placed.push(winner.choice.sector);
    }
  }
  return result;
}

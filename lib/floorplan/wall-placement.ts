type Point = { x: number; y: number };
type Segment = { a: Point; b: Point };

/** A stored wall's centre line: walls are stored by the corner of their stroke. */
export function wallCentreLine(wall: { x: number; y: number; x2: number; y2: number; strokeWidth: number }): Segment {
  const half = wall.strokeWidth / 2;
  return { a: { x: wall.x + half, y: wall.y + half }, b: { x: wall.x2 + half, y: wall.y2 + half } };
}

function nearestOnSegment(point: Point, { a, b }: Segment): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

/**
 * Where a click lands for a wall end: on the end of a wall within reach, else on the line of a
 * wall within reach, so new walls meet existing ones; anywhere else it stays put.
 */
export function snapWallPoint(point: Point, walls: Segment[], reach: number): Point {
  let best: { point: Point; gap: number } | null = null;
  for (const wall of walls) {
    for (const end of [wall.a, wall.b]) {
      const gap = distance(point, end);
      if (gap <= reach && (!best || gap < best.gap)) best = { point: end, gap };
    }
  }
  if (best) return best.point;

  for (const wall of walls) {
    const onLine = nearestOnSegment(point, wall);
    const gap = distance(point, onLine);
    if (gap <= reach && (!best || gap < best.gap)) best = { point: onLine, gap };
  }
  return best?.point ?? point;
}

/**
 * A wall from two clicks: each end snapped to the walls around it; with `straight` the second
 * end is held level or plumb with the first. Returned stored by its stroke corner, as every
 * wall is.
 */
export function wallFromClicks(
  start: Point,
  end: Point,
  options: { strokeWidth: number; walls: Segment[]; reach: number; straight: boolean },
) {
  const from = snapWallPoint(start, options.walls, options.reach);
  let to = snapWallPoint(end, options.walls, options.reach);
  if (options.straight) {
    to = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  }
  const half = options.strokeWidth / 2;
  return { x: from.x - half, y: from.y - half, x2: to.x - half, y2: to.y - half, strokeWidth: options.strokeWidth };
}

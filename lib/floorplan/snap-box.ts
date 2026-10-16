export type SnapBox = { left: number; top: number; right: number; bottom: number };

const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) > Math.max(a0, b0);

/** The smallest of these moves, if it is within reach. */
function nearestMove(moves: number[], reach: number) {
  const best = moves.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a), Infinity);
  return Math.abs(best) <= reach ? best : null;
}

export const low = (box: SnapBox, axis: number) => (axis === 0 ? box.left : box.top);
export const high = (box: SnapBox, axis: number) => (axis === 0 ? box.right : box.bottom);

/**
 * How far to move a box so it stands against a wall or, for an appliance, sits in line on a
 * counter. On a counter it lines up with the counter's back, the side against a wall (or the
 * nearer side when neither is), and with its ends when close; otherwise each side of the box
 * snaps to the face of a wall beside it.
 */
export function snapBoxToFixtures(box: SnapBox, walls: SnapBox[], counters: SnapBox[], reach: number) {
  const moves: [number | null, number | null] = [null, null];

  const counter = counters.find(
    (candidate) =>
      overlaps(box.left, box.right, candidate.left, candidate.right) &&
      overlaps(box.top, box.bottom, candidate.top, candidate.bottom),
  );
  if (counter) {
    const along = counter.right - counter.left >= counter.bottom - counter.top ? 0 : 1;
    const across = 1 - along;
    const beside = walls.filter((wall) => overlaps(low(wall, along), high(wall, along), low(counter, along), high(counter, along)));
    const gap = (distances: number[]) => Math.min(Infinity, ...distances.map(Math.abs));
    const lowGap = gap(beside.map((wall) => high(wall, across) - low(counter, across)));
    const highGap = gap(beside.map((wall) => low(wall, across) - high(counter, across)));
    const lowBack = low(counter, across) - low(box, across);
    const highBack = high(counter, across) - high(box, across);
    moves[across] =
      Math.min(lowGap, highGap) <= reach
        ? lowGap <= highGap ? lowBack : highBack
        : nearestMove([lowBack, highBack], Infinity);
    moves[along] = nearestMove([low(counter, along) - low(box, along), high(counter, along) - high(box, along)], reach);
  }

  moves[0] ??= nearestMove(
    walls
      .filter((wall) => overlaps(box.top, box.bottom, wall.top, wall.bottom))
      .flatMap((wall) => [wall.right - box.left, wall.left - box.right]),
    reach,
  );
  moves[1] ??= nearestMove(
    walls
      .filter((wall) => overlaps(box.left, box.right, wall.left, wall.right))
      .flatMap((wall) => [wall.bottom - box.top, wall.top - box.bottom]),
    reach,
  );
  return { dx: moves[0] ?? 0, dy: moves[1] ?? 0 };
}

/**
 * How far to move one side of a box being stretched (`axis` 0 across the plan, 1 down it) so it
 * meets the face of a wall it is reaching for, or null when no wall is within reach.
 */
export function snapStretchedSide(box: SnapBox, axis: number, movingHigh: boolean, walls: SnapBox[], reach: number) {
  const other = 1 - axis;
  const facing = walls.filter((wall) => overlaps(low(wall, other), high(wall, other), low(box, other), high(box, other)));
  return nearestMove(
    facing.map((wall) => (movingHigh ? low(wall, axis) - high(box, axis) : high(wall, axis) - low(box, axis))),
    reach,
  );
}

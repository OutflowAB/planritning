import type { PlanAlignment } from "@/lib/polycam/parse-roomplan";

/**
 * Where north points in the rendered plan, as degrees clockwise from "up" in the image.
 *
 * ASSUMPTION (unverified, must be checked against a scan of a real address with a known
 * facing before anyone relies on it): `orientation.orientation_degrees` is the compass
 * heading, clockwise from north, in which the scan's world -z axis points. RoomPlan starts
 * its world looking down -z, and render-plan draws world x to the right and world z downward,
 * so -z is "up" in the unaligned image: north then lies `heading` degrees counter-clockwise
 * from up. render-plan then rotates the plan with `alignment_transform` to square the walls
 * up, and north has to be turned by the same rotation.
 *
 * If a real address shows the arrow mirrored, the fix is the sign of `orientationDegrees`
 * below; if it is off by a constant, the heading refers to another axis.
 */
export function compassRotationFromScan(
  orientationDegrees: number | null,
  alignment: PlanAlignment | null,
): number | null {
  if (orientationDegrees === null || !Number.isFinite(orientationDegrees)) {
    return null;
  }

  // North as a world-plane direction: x right, z down, so "up" is (0, -1).
  const heading = (orientationDegrees * Math.PI) / 180;
  const north = { x: -Math.sin(heading), z: -Math.cos(heading) };

  // Same plane rotation render-plan applies to every wall direction.
  const a = alignment ?? { t00: 1, t02: 0, t03: 0, t20: 0, t22: 1, t23: 0 };
  const x = a.t00 * north.x + a.t02 * north.z;
  const z = a.t20 * north.x + a.t22 * north.z;

  const degrees = (Math.atan2(x, -z) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

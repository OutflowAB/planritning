import type { FloorplanDocument, FloorplanScale } from "@/lib/floorplan/types";

const ONE_DECIMAL = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "4,2 m" — Swedish decimal comma. */
export function formatMeters(meters: number) {
  return `${ONE_DECIMAL.format(meters)} m`;
}

/** "12,5 m²". */
export function formatSquareMeters(squareMeters: number) {
  return `${ONE_DECIMAL.format(squareMeters)} m²`;
}

/** Area of a simple polygon (shoelace formula), in the square of its units. */
export function polygonArea(points: ReadonlyArray<readonly [number, number]>) {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

/** Length in metres of a line drawn on a plan with this scale. */
export function lineLengthInMeters(
  scale: FloorplanScale,
  line: { x: number; y: number; x2: number; y2: number },
) {
  return Math.hypot(line.x2 - line.x, line.y2 - line.y) / scale.pxPerMeter;
}

/** Sum of the room areas the plan knows, or null when it knows none. */
export function totalRoomArea(document: FloorplanDocument) {
  const areas = document.objects.flatMap((object) =>
    object.type === "roomLabel" && object.areaM2 !== undefined ? [object.areaM2] : [],
  );
  return areas.length > 0 ? { squareMeters: areas.reduce((sum, area) => sum + area, 0), rooms: areas.length } : null;
}

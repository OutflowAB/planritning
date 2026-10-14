import { sheetTextSvg } from "@/lib/image/sheet-font";

/**
 * The compass badge of the client's own reference sheets, top right: an outer and an inner
 * circle forming a ring band, the band cut into four segments by short radial ticks on the
 * intercardinal directions, N/E/S/W sitting inside the band, and in the middle an arrowhead
 * needle from north with the western half filled black and the eastern half an outline.
 *
 * All sizes are fractions of the outer radius, measured off the references. The WHOLE badge
 * (letters included) turns as one piece; the letters stay upright relative to the badge.
 */
export const COMPASS_GEOMETRY = {
  /** Inner circle radius over the outer one. */
  innerRatio: 0.617,
  /** Stroke width over the outer radius. */
  strokeRatio: 0.015,
  /** Cap height of the letters over the outer radius; the font size follows from the font. */
  letterSizeRatio: 0.26,
  /** The needle tip sits just inside the inner circle (over the inner radius). */
  needleTip: 1,
  /** The needle's wings touch the inner circle at 135° and 225° from north, where the ticks run. */
  wingAngleDegrees: 135,
  /** The tail notch between the wings (over the inner radius, positive = towards south). */
  needleTail: 0.49,
} as const;

export type CompassLayout = {
  outerRadius: number;
  innerRadius: number;
  /** Middle of the ring band, where the letters are centred. */
  letterRadius: number;
  stroke: number;
};

export function compassLayout(outerRadius: number): CompassLayout {
  const innerRadius = outerRadius * COMPASS_GEOMETRY.innerRatio;
  return {
    outerRadius,
    innerRadius,
    letterRadius: (outerRadius + innerRadius) / 2,
    stroke: Math.max(1.5, outerRadius * COMPASS_GEOMETRY.strokeRatio),
  };
}

/** The needle's vertices in the badge's own frame (north up, origin at the centre, y down). */
export function compassNeedlePoints(innerRadius: number) {
  const wing = (COMPASS_GEOMETRY.wingAngleDegrees * Math.PI) / 180;
  return {
    north: { x: 0, y: -innerRadius * COMPASS_GEOMETRY.needleTip },
    west: { x: -Math.sin(wing) * innerRadius, y: -Math.cos(wing) * innerRadius },
    east: { x: Math.sin(wing) * innerRadius, y: -Math.cos(wing) * innerRadius },
    tail: { x: 0, y: innerRadius * COMPASS_GEOMETRY.needleTail },
  };
}

/**
 * `outerRadius` is the badge's outer circle. `rotationDegrees` is where north points,
 * clockwise from the top of the sheet. Returns an SVG fragment in sheet pixel coordinates.
 */
export function compassSvg(
  centerX: number,
  centerY: number,
  outerRadius: number,
  rotationDegrees: number,
): string {
  const { innerRadius, letterRadius, stroke } = compassLayout(outerRadius);
  const point = (p: { x: number; y: number }) => `${(centerX + p.x).toFixed(2)},${(centerY + p.y).toFixed(2)}`;

  // Ticks run across the band on the intercardinal directions.
  const ticks = [45, 135, 225, 315]
    .map(
      (angle) =>
        `<line x1="${centerX}" y1="${centerY - innerRadius}" x2="${centerX}" y2="${centerY - outerRadius}" transform="rotate(${angle} ${centerX} ${centerY})" />`,
    )
    .join("");

  const needle = compassNeedlePoints(innerRadius);
  const blackHalf = `<polygon points="${point(needle.north)} ${point(needle.west)} ${point(needle.tail)}" fill="#000000" />`;
  const whiteHalf = `<polygon points="${point(needle.north)} ${point(needle.east)} ${point(needle.tail)}" fill="none" />`;

  const letters = (["N", "E", "S", "W"] as const)
    .map((letter, index) => {
      const angle = (index * Math.PI) / 2;
      return sheetTextSvg(letter, {
        centerX: centerX + Math.sin(angle) * letterRadius,
        centerY: centerY - Math.cos(angle) * letterRadius,
        size: (outerRadius * COMPASS_GEOMETRY.letterSizeRatio) / 0.7,
      });
    })
    .join("");

  return `
    <g transform="rotate(${rotationDegrees} ${centerX} ${centerY})">
      <g fill="none" stroke="#000000" stroke-width="${stroke}" stroke-linejoin="miter">
        <circle cx="${centerX}" cy="${centerY}" r="${outerRadius}" />
        <circle cx="${centerX}" cy="${centerY}" r="${innerRadius}" />
        ${ticks}
        ${blackHalf}
        ${whiteHalf}
      </g>
      ${letters}
    </g>`;
}

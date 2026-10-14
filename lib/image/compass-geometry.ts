/**
 * The compass badge's proportions, in one client-safe file (no font, no node modules) so the
 * browser's preview draws the same shape the sheet does. See sheet-compass.ts for the drawing.
 *
 * The badge of the client's own reference sheets, top right: an outer and an inner
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
  /** The needle tip sits on the inner circle (over the inner radius). */
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
 * How far each letter is turned. The references turn the letters with the badge, but never
 * leave one upside down: past a quarter turn either way the letter is flipped by 180° so it
 * stays readable, only tilted. Positions still travel with the badge. Result in (-90, 90].
 */
export function compassLetterTilt(rotationDegrees: number): number {
  const wrapped = ((((rotationDegrees + 180) % 360) + 360) % 360) - 180; // [-180, 180)
  if (wrapped > 90) return wrapped - 180;
  if (wrapped <= -90) return wrapped + 180;
  return wrapped;
}

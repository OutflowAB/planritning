import { compassLayout, compassLetterTilt, compassNeedlePoints, COMPASS_GEOMETRY } from "@/lib/image/compass-geometry";
import { sheetTextSvg } from "@/lib/image/sheet-font";

export { COMPASS_GEOMETRY, compassLayout, compassLetterTilt, compassNeedlePoints };
export type { CompassLayout } from "@/lib/image/compass-geometry";

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

  // The letters sit where the badge carries them but stay readable: see compassLetterTilt.
  const tilt = compassLetterTilt(rotationDegrees);
  const letters = (["N", "E", "S", "W"] as const)
    .map((letter, index) => {
      const angle = ((rotationDegrees + index * 90) * Math.PI) / 180;
      const x = centerX + Math.sin(angle) * letterRadius;
      const y = centerY - Math.cos(angle) * letterRadius;
      return `<g transform="rotate(${tilt} ${x.toFixed(2)} ${y.toFixed(2)})">${sheetTextSvg(letter, {
        centerX: x,
        centerY: y,
        size: (outerRadius * COMPASS_GEOMETRY.letterSizeRatio) / 0.7,
      })}</g>`;
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
    </g>
    ${letters}`;
}

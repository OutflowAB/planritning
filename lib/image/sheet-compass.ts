import { sheetTextSvg } from "@/lib/image/sheet-font";

/**
 * The compass rose the house-style sheets carry top right: a thin double ring with tick
 * marks, a filled black needle pointing north and N/E/S/W around it. The letters stay upright
 * (as in the references) and only travel around the ring with the rotation.
 *
 * `rotationDegrees` is where north points, clockwise from the top of the sheet.
 * Returns an SVG fragment in sheet pixel coordinates.
 */
export function compassSvg(
  centerX: number,
  centerY: number,
  radius: number,
  rotationDegrees: number,
): string {
  const stroke = Math.max(1, radius * 0.03);
  // The rings sit inside `radius`, leaving the outer band to the letters.
  const ringR = radius * 0.72;
  const rotate = `rotate(${rotationDegrees} ${centerX} ${centerY})`;

  // 16 ticks between the two rings; the four cardinal ones reach the outer ring.
  const ticks = Array.from({ length: 16 }, (_, index) => {
    const angle = (index * 360) / 16;
    const inner = ringR * (index % 4 === 0 ? 0.7 : 0.85);
    return `<line x1="${centerX}" y1="${centerY - inner}" x2="${centerX}" y2="${centerY - ringR}" transform="rotate(${angle} ${centerX} ${centerY})" />`;
  }).join("");

  // Kite needle: the northern half is solid black, the southern half an outline.
  const tip = radius * 0.7;
  const side = radius * 0.2;
  const needle = `
    <polygon points="${centerX},${centerY - tip} ${centerX + side},${centerY} ${centerX},${centerY + radius * 0.12} ${centerX - side},${centerY}" fill="#000000" />
    <polygon points="${centerX},${centerY + tip} ${centerX + side},${centerY} ${centerX},${centerY - radius * 0.12} ${centerX - side},${centerY}" fill="none" />`;

  const letterRadius = radius * 0.93;
  const letters = (["N", "E", "S", "W"] as const)
    .map((letter, index) => {
      const angle = ((rotationDegrees + index * 90) * Math.PI) / 180;
      return sheetTextSvg(letter, {
        centerX: centerX + Math.sin(angle) * letterRadius,
        centerY: centerY - Math.cos(angle) * letterRadius,
        size: radius * 0.4,
      });
    })
    .join("");

  return `
    <g fill="none" stroke="#000000" stroke-width="${stroke}">
      <circle cx="${centerX}" cy="${centerY}" r="${ringR}" />
      <circle cx="${centerX}" cy="${centerY}" r="${ringR * 0.7}" />
      <g transform="${rotate}">${ticks}<g stroke-linejoin="miter">${needle}</g></g>
    </g>
    ${letters}`;
}

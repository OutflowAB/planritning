import { readFileSync } from "node:fs";
import path from "node:path";

import opentype from "opentype.js";

/**
 * The typeface of everything the code writes on the sheet (heading, compass letters).
 *
 * The client's own site uses the commercial font Neutra, which we may not ship. Questrial
 * (SIL OFL) is the free geometric sans that sits closest to it. To switch to the licensed
 * file later, change exactly these two constants: drop the .ttf/.otf into assets/fonts/ and
 * point SHEET_FONT_FILE at it. If the new file has a real bold weight, set
 * SHEET_FONT_EMBOLDEN_EM to 0 — Questrial only has a regular weight, so the bold look is made
 * by stroking the glyph outlines.
 */
export const SHEET_FONT_FILE = "Questrial-Regular.ttf";
export const SHEET_FONT_EMBOLDEN_EM = 0.035;

/**
 * Resolved from the project root, not from this file: a bundled route runs from a different
 * directory, and next.config.ts traces the font by the same root-relative path.
 */
export const SHEET_FONT_PATH = path.join(process.cwd(), "assets", "fonts", SHEET_FONT_FILE);

/**
 * Glyphs are turned into SVG outlines instead of asking the renderer for text, so the sheet
 * never depends on a system font being installed on the server (Vercel has none).
 */
let cachedFont: opentype.Font | null = null;

function loadFont(): opentype.Font {
  if (!cachedFont) {
    const file = readFileSync(SHEET_FONT_PATH);
    cachedFont = opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  }
  return cachedFont;
}

export type SheetTextOptions = {
  /** Horizontal centre of the text. */
  centerX: number;
  /** Vertical centre of the capital letters (not the baseline), so layout can ignore font metrics. */
  centerY: number;
  /** Font size in px. */
  size: number;
  /** Extra space between letters, in em. */
  letterSpacingEm?: number;
  fill?: string;
};

/** An SVG fragment (a single <path>) with the text centred on the given point. */
export function sheetTextSvg(text: string, options: SheetTextOptions): string {
  const { centerX, centerY, size, letterSpacingEm = 0, fill = "#000000" } = options;
  const font = loadFont();
  const spacing = letterSpacingEm * size;

  // Measured per glyph so the trailing letter-space does not push the text off-centre.
  const advance = font.getAdvanceWidth(text, size);
  const width = advance + spacing * (text.length - 1);

  const capHeight = (font.tables.os2?.sCapHeight ?? font.unitsPerEm * 0.7) * (size / font.unitsPerEm);
  const baseline = centerY + capHeight / 2;

  const path = font.getPath(text, centerX - width / 2, baseline, size, {
    letterSpacing: letterSpacingEm,
  });
  const stroke = SHEET_FONT_EMBOLDEN_EM * size;

  return path
    .toSVG(2)
    .replace(
      "<path",
      `<path fill="${fill}" stroke="${fill}" stroke-width="${stroke}" stroke-linejoin="round"`,
    );
}

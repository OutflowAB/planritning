/** SkandiaMäklarna grafiska profil — delad mellan generering och redigerare. */
export const SM_BEIGE = "#E1D4C8";
export const SM_BEIGE_RGB = { r: 225, g: 212, b: 200 } as const;
export const SM_INK = "#1A1A1A";
export const SM_INK_MUTED = "#4D463F";
export const SM_WALL_STROKE = 3;
export const SM_DIMENSION_STROKE = 1.5;
/** Line width of doors, windows, stairs and fixtures drawn from a scan. */
export const SM_ICON_STROKE = 2;
export const SM_ROOM_LABEL_FONT = "Arial, Helvetica, sans-serif";
export const SM_DIMENSION_FONT = "Arial, Helvetica, sans-serif";

export const SM_EDITOR = {
  background: SM_BEIGE,
  ink: SM_INK,
  inkMuted: SM_INK_MUTED,
  wallStroke: SM_WALL_STROKE,
  dimensionStroke: SM_DIMENSION_STROKE,
  roomLabelFontFamily: SM_ROOM_LABEL_FONT,
  dimensionFontFamily: SM_DIMENSION_FONT,
  selectionColor: "#5C544A",
  selectionBorderColor: "#5C544A",
  selectionFill: "rgba(92, 84, 74, 0.12)",
  selectionCornerSize: 6,
  selectionTouchCornerSize: 12,
  selectionTransparentCorners: true,
  selectionBorderScaleFactor: 1,
  gridColor: "rgba(92, 84, 74, 0.08)",
  toolbarWidth: 72,
  propertiesWidth: 280,
  eraserBrushWidth: 28,
  eraserCursorBorderWidth: 1,
  eraserCursorBorderColor: "rgba(77, 70, 63, 0.55)",
} as const;

const SM_ROOM_LABEL_SIZE_RATIO = 0.015;

/** Room name size for a canvas this wide, so labels read the same on every plan size. */
export function roomLabelFontSize(canvasWidth: number) {
  return Math.max(12, Math.round(canvasWidth * SM_ROOM_LABEL_SIZE_RATIO));
}

/**
 * The built-in sizes of hand-placed symbols, furniture, doors, windows and stairs were drawn for
 * a ~1200 px wide plan. This scales them up to the canvas they are placed on.
 */
export function defaultObjectScale(canvasWidth: number) {
  return Math.max(1, canvasWidth / 1200);
}

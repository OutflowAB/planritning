/** SkandiaMäklarna grafiska profil — delad mellan generering och redigerare. */
export const SM_BEIGE = "#E1D4C8";
export const SM_BEIGE_RGB = { r: 225, g: 212, b: 200 } as const;
export const SM_INK = "#1A1A1A";
export const SM_INK_MUTED = "#4D463F";
export const SM_WALL_STROKE = 3;
export const SM_DIMENSION_STROKE = 1.5;
export const SM_ASPECT_RATIO_WIDTH = 7;
export const SM_ASPECT_RATIO_HEIGHT = 5;
export const SM_CONTENT_PADDING_PX = 80;
export const SM_LOGO_GAP_PX = 44;
export const SM_OUTER_FRAME_STROKE_PX = 3;
export const SM_OUTER_FRAME_INSET_PX = 30;
export const SM_LOGO_MAX_WIDTH_PX = 360;
export const SM_LOGO_WIDTH_RATIO = 0.3;
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

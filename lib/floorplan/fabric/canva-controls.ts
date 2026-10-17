import {
  Control,
  controlsUtils,
  InteractiveFabricObject,
  Point,
  type ControlRenderingStyleOverride,
  type FabricObject,
  type Line,
} from "fabric";

export const CANVA_PURPLE = "#8B3DFF";
export const CANVA_HANDLE_SIZE = 10;
export const CANVA_ACTION_SIZE = 28;
export const CANVA_ACTION_OFFSET = 26;

export const CANVA_SELECTION_PROPS = {
  // Turning snaps to the nearest eighth of a turn within a few degrees, and is free in between.
  snapAngle: 45,
  snapThreshold: 6,
  borderColor: CANVA_PURPLE,
  cornerColor: "#ffffff",
  cornerStrokeColor: CANVA_PURPLE,
  cornerStyle: "circle" as const,
  transparentCorners: false,
  cornerSize: CANVA_HANDLE_SIZE,
  touchCornerSize: 22,
  borderScaleFactor: 1,
  padding: 0,
  selectionBackgroundColor: "",
};

let installed = false;

/*
 * The canvas is drawn at the plan's full size (3000 px and more) and shrunk by CSS to fit the
 * screen, which would shrink a 10 px handle to 2. Handles are drawn this many times larger so they
 * keep their size on screen; the editor sets it whenever the canvas is resized or zoomed.
 */
let handleScale = 1;

export function setHandleScale(canvasPixelsPerScreenPixel: number) {
  handleScale = canvasPixelsPerScreenPixel;
}

/** A distance on screen in canvas pixels, at the current zoom. */
export function canvasPixels(screenPixels: number) {
  return screenPixels * handleScale;
}

/** The control with its sizes and offsets kept the same on screen, at any zoom. */
function screenSized(control: Control) {
  const touch = Math.max(control.sizeX, control.sizeY, 22);
  const base = {
    sizeX: control.sizeX,
    sizeY: control.sizeY,
    touchSizeX: touch,
    touchSizeY: touch,
    offsetX: control.offsetX,
    offsetY: control.offsetY,
  };
  for (const [key, value] of Object.entries(base)) {
    Object.defineProperty(control, key, { get: () => value * handleScale, configurable: true });
  }
  return control;
}

function drawWhiteHandle(
  ctx: CanvasRenderingContext2D,
  radius: number,
  strokeColor: string,
) {
  ctx.beginPath();
  ctx.arc(0, 0, radius + 1, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function renderCanvaCornerHandle(
  this: Control,
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  styleOverride: ControlRenderingStyleOverride,
  fabricObject: FabricObject,
) {
  const size = styleOverride.cornerSize ?? fabricObject.cornerSize ?? CANVA_HANDLE_SIZE;
  ctx.save();
  ctx.translate(left, top);
  ctx.scale(handleScale, handleScale);
  drawWhiteHandle(ctx, size / 2, styleOverride.cornerStrokeColor ?? CANVA_PURPLE);
  ctx.restore();
}

function drawRotateIcon(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "#5f6368";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.arc(0, 0, 5.5, 0.35 * Math.PI, 1.65 * Math.PI);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-2.2, -6.2);
  ctx.lineTo(-4.8, -4.8);
  ctx.lineTo(-2.8, -3.2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(2.2, 6.2);
  ctx.lineTo(4.8, 4.8);
  ctx.lineTo(2.8, 3.2);
  ctx.stroke();
}

function drawMoveIcon(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "#5f6368";
  ctx.fillStyle = "#5f6368";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const arm = 5.5;
  ctx.beginPath();
  ctx.moveTo(0, -arm);
  ctx.lineTo(0, arm);
  ctx.moveTo(-arm, 0);
  ctx.lineTo(arm, 0);
  ctx.stroke();

  const head = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, -arm);
  ctx.lineTo(-head, -arm + head);
  ctx.moveTo(0, -arm);
  ctx.lineTo(head, -arm + head);
  ctx.moveTo(0, arm);
  ctx.lineTo(-head, arm - head);
  ctx.moveTo(0, arm);
  ctx.lineTo(head, arm - head);
  ctx.moveTo(-arm, 0);
  ctx.lineTo(-arm + head, -head);
  ctx.moveTo(-arm, 0);
  ctx.lineTo(-arm + head, head);
  ctx.moveTo(arm, 0);
  ctx.lineTo(arm - head, -head);
  ctx.moveTo(arm, 0);
  ctx.lineTo(arm - head, head);
  ctx.stroke();
}

function renderCanvaActionHandle(
  icon: (ctx: CanvasRenderingContext2D) => void,
) {
  return function renderActionHandle(
    this: Control,
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
  ) {
    const radius = CANVA_ACTION_SIZE / 2;
    ctx.save();
    ctx.translate(left, top);
    ctx.scale(handleScale, handleScale);
    drawWhiteHandle(ctx, radius, CANVA_PURPLE);
    icon(ctx);
    ctx.restore();
  };
}

function createCornerControl(x: number, y: number) {
  return screenSized(new Control({
    x,
    y,
    sizeX: CANVA_HANDLE_SIZE,
    sizeY: CANVA_HANDLE_SIZE,
    cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
    actionHandler: controlsUtils.scalingEqually,
    render: renderCanvaCornerHandle,
  }));
}

export function createCanvaControls() {
  return {
    tl: createCornerControl(-0.5, -0.5),
    tr: createCornerControl(0.5, -0.5),
    bl: createCornerControl(-0.5, 0.5),
    br: createCornerControl(0.5, 0.5),
    canvaRotate: screenSized(new Control({
      x: -0.5,
      y: 0.5,
      offsetY: CANVA_ACTION_OFFSET,
      sizeX: CANVA_ACTION_SIZE,
      sizeY: CANVA_ACTION_SIZE,
      cursorStyleHandler: controlsUtils.rotationStyleHandler,
      actionHandler: controlsUtils.rotationWithSnapping,
      actionName: "rotate",
      render: renderCanvaActionHandle(drawRotateIcon),
    })),
    canvaMove: screenSized(new Control({
      x: 0.5,
      y: 0.5,
      offsetY: CANVA_ACTION_OFFSET,
      sizeX: CANVA_ACTION_SIZE,
      sizeY: CANVA_ACTION_SIZE,
      cursorStyleHandler: () => "move",
      actionHandler: controlsUtils.dragHandler,
      actionName: "drag",
      render: renderCanvaActionHandle(drawMoveIcon),
    })),
  };
}

/** A wall's two ends on the canvas, whatever it has since been moved, turned or scaled by. */
function wallEnds(wall: Line): [Point, Point] {
  const matrix = wall.calcTransformMatrix();
  const local = wall.calcLinePoints();
  return [new Point(local.x1, local.y1).transform(matrix), new Point(local.x2, local.y2).transform(matrix)];
}

/** The way from a wall's other end to this one, one unit long, and the wall's length. */
function wallDirection(wall: Line, end: 0 | 1) {
  const ends = wallEnds(wall);
  const fixed = ends[1 - end];
  const length = fixed.distanceFrom(ends[end]);
  return { fixed, length, unit: length > 0 ? ends[end].subtract(fixed).scalarDivide(length) : new Point(1, 0) };
}

/**
 * A handle in the middle of a wall's end. Dragging it lengthens or shortens the wall along its
 * own line, so the wall keeps its angle and its other end stays put.
 */
function createWallEndControl(end: 0 | 1) {
  return screenSized(new Control({
    sizeX: CANVA_HANDLE_SIZE,
    sizeY: CANVA_HANDLE_SIZE,
    actionName: "stretch",
    positionHandler: (_dim, _matrix, object) => {
      const wall = object as Line;
      const { fixed, length, unit } = wallDirection(wall, end);
      // The square cap reaches half the stroke past the end point: the handle sits on its face.
      return fixed.add(unit.scalarMultiply(length + wall.strokeWidth / 2)).transform(wall.getViewportTransform());
    },
    cursorStyleHandler: (_event, _control, object) => {
      const { unit } = wallDirection(object as Line, end);
      return Math.abs(unit.x) >= Math.abs(unit.y) ? "ew-resize" : "ns-resize";
    },
    actionHandler: (_event, transform, x, y) => {
      const wall = transform.target as Line;
      const { fixed, length, unit } = wallDirection(wall, end);
      if (length === 0) return false;
      // How far along the wall the pointer is, less the cap it is holding; never shorter than
      // the wall is thick, so it cannot vanish or turn round.
      const along = (x - fixed.x) * unit.x + (y - fixed.y) * unit.y - wall.strokeWidth / 2;
      const moved = fixed.add(unit.scalarMultiply(Math.max(along, wall.strokeWidth)));
      const [first, second] = end === 0 ? [moved, fixed] : [fixed, moved];
      // The ends are set in canvas coordinates, so any earlier turn or scale is folded into them.
      wall.set({ angle: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, flipX: false, flipY: false });
      wall.set({ x1: first.x, y1: first.y, x2: second.x, y2: second.y });
      wall.setCoords();
      return true;
    },
    render: renderCanvaCornerHandle,
  }));
}

function createSideControl(x: number, y: number) {
  return screenSized(new Control({
    x,
    y,
    sizeX: CANVA_HANDLE_SIZE,
    sizeY: CANVA_HANDLE_SIZE,
    cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
    actionHandler: x === 0 ? controlsUtils.scalingY : controlsUtils.scalingX,
    render: renderCanvaCornerHandle,
  }));
}

/**
 * A box built to measure (a counter, a wardrobe): the usual handles plus one in the middle of each
 * side, which stretches the box from that side while the opposite side stays put.
 */
export function createStretchControls() {
  return {
    ...createCanvaControls(),
    ml: createSideControl(-0.5, 0),
    mr: createSideControl(0.5, 0),
    mt: createSideControl(0, -0.5),
    mb: createSideControl(0, 0.5),
  };
}

/** A wall's handles: one at each end to stretch it, and the usual turn and move handles. */
export function createWallControls() {
  const { canvaRotate, canvaMove } = createCanvaControls();
  return { start: createWallEndControl(0), end: createWallEndControl(1), canvaRotate, canvaMove };
}

export function installCanvaSelectionStyle() {
  if (installed) {
    return;
  }
  installed = true;

  Object.assign(InteractiveFabricObject.ownDefaults, CANVA_SELECTION_PROPS);
  InteractiveFabricObject.createControls = () => ({
    controls: createCanvaControls(),
  });
}

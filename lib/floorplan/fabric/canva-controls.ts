import {
  Control,
  controlsUtils,
  InteractiveFabricObject,
  type ControlRenderingStyleOverride,
  type FabricObject,
} from "fabric";

export const CANVA_PURPLE = "#8B3DFF";
export const CANVA_HANDLE_SIZE = 10;
export const CANVA_ACTION_SIZE = 28;
export const CANVA_ACTION_OFFSET = 26;

export const CANVA_SELECTION_PROPS = {
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
    drawWhiteHandle(ctx, radius, CANVA_PURPLE);
    icon(ctx);
    ctx.restore();
  };
}

function createCornerControl(x: number, y: number) {
  return new Control({
    x,
    y,
    sizeX: CANVA_HANDLE_SIZE,
    sizeY: CANVA_HANDLE_SIZE,
    cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
    actionHandler: controlsUtils.scalingEqually,
    render: renderCanvaCornerHandle,
  });
}

export function createCanvaControls() {
  return {
    tl: createCornerControl(-0.5, -0.5),
    tr: createCornerControl(0.5, -0.5),
    bl: createCornerControl(-0.5, 0.5),
    br: createCornerControl(0.5, 0.5),
    canvaRotate: new Control({
      x: -0.5,
      y: 0.5,
      offsetY: CANVA_ACTION_OFFSET,
      sizeX: CANVA_ACTION_SIZE,
      sizeY: CANVA_ACTION_SIZE,
      cursorStyleHandler: controlsUtils.rotationStyleHandler,
      actionHandler: controlsUtils.rotationWithSnapping,
      actionName: "rotate",
      render: renderCanvaActionHandle(drawRotateIcon),
    }),
    canvaMove: new Control({
      x: 0.5,
      y: 0.5,
      offsetY: CANVA_ACTION_OFFSET,
      sizeX: CANVA_ACTION_SIZE,
      sizeY: CANVA_ACTION_SIZE,
      cursorStyleHandler: () => "move",
      actionHandler: controlsUtils.dragHandler,
      actionName: "drag",
      render: renderCanvaActionHandle(drawMoveIcon),
    }),
  };
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

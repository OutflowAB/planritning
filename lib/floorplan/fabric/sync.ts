import {
  Circle,
  FabricImage,
  FabricObject,
  FabricText,
  Group,
  Line,
  Path,
  PencilBrush,
  Rect,
  type Canvas,
  type TComplexPathData,
} from "fabric";

import {
  getFurnitureById,
  getSymbolById,
} from "@/lib/floorplan/symbol-library";
import type {
  EraserStrokeObject,
  FloorplanDocument,
  FloorplanObject,
  FloorplanObjectType,
  FurnitureObject,
  SymbolObject,
} from "@/lib/floorplan/types";
import { SM_EDITOR, SM_INK } from "@/lib/sm-floorplan-layout";
import { CANVA_PURPLE, CANVA_SELECTION_PROPS, createWallControls } from "@/lib/floorplan/fabric/canva-controls";

const FLOORPLAN_DATA_KEY = "floorplan";
const FLOORPLAN_BACKGROUND_KEY = "floorplan-background";
const FLOORPLAN_GUIDE_KEY = "floorplan-guide";

/** Help lines drawn over the plan in the editor only, never part of the document's objects. */
export function drawGuides(canvas: Canvas, document: FloorplanDocument | null | undefined, visible: boolean) {
  if (!isCanvasOperational(canvas)) {
    return;
  }
  for (const old of canvas.getObjects().filter((object) => object.get(FLOORPLAN_GUIDE_KEY))) {
    canvas.remove(old);
  }
  for (const [x1, y1, x2, y2] of visible ? (document?.guides?.meshWindows ?? []) : []) {
    const line = new Line([x1, y1, x2, y2], {
      stroke: "#1d9bf0",
      strokeWidth: 8,
      strokeDashArray: [14, 10],
      selectable: false,
      evented: false,
      excludeFromExport: true,
    });
    line.set(FLOORPLAN_GUIDE_KEY, true);
    canvas.add(line);
    canvas.bringObjectToFront(line);
  }
  canvas.requestRenderAll();
}

export function isCanvasOperational(canvas: Canvas | null | undefined): canvas is Canvas {
  return Boolean(canvas && !canvas.disposed && !canvas.destroyed);
}

const backgroundImageCache = new Map<string, Promise<FabricImage>>();

async function loadMasterBackgroundImage(url: string): Promise<FabricImage> {
  const cached = backgroundImageCache.get(url);
  if (cached) {
    return cached;
  }

  const pending = FabricImage.fromURL(url, { crossOrigin: "anonymous" }).catch((error) => {
    backgroundImageCache.delete(url);
    throw error instanceof Error ? error : new Error("Kunde inte ladda planritningsbilden.");
  });

  backgroundImageCache.set(url, pending);
  return pending;
}

/** Varje render behöver en egen FabricImage — samma instans får inte återanvändas efter canvas.clear(). */
async function loadFloorplanBackgroundImage(url: string): Promise<FabricImage> {
  const master = await loadMasterBackgroundImage(url);
  return (await master.clone()) as FabricImage;
}

export function hasFloorplanBackground(canvas: Canvas): boolean {
  return canvas.getObjects().some((object) => Boolean(object.get(FLOORPLAN_BACKGROUND_KEY)));
}

const ERASER_STROKE_PROPS = {
  fill: "",
  stroke: SM_EDITOR.background,
  strokeLineCap: "round" as const,
  strokeLineJoin: "round" as const,
  selectable: false,
  evented: false,
};

export function configureCanvasSelectionStyle(canvas: Canvas) {
  if (!isCanvasOperational(canvas)) {
    return;
  }

  canvas.set({
    selectionColor: "rgba(139, 61, 255, 0.08)",
    selectionBorderColor: CANVA_PURPLE,
  });
}

const FLOORPLAN_SELECTION_PROPS = CANVA_SELECTION_PROPS;

export function configureCanvasToolMode(
  canvas: Canvas,
  activeTool: "select" | "eraser" | string,
) {
  if (!isCanvasOperational(canvas)) {
    return;
  }

  canvas.clipPath = undefined;

  if (activeTool === "eraser") {
    canvas.isDrawingMode = true;
    canvas.selection = false;
    canvas.discardActiveObject();
    canvas.defaultCursor = "none";
    canvas.hoverCursor = "none";
    canvas.moveCursor = "none";
    canvas.freeDrawingBrush = new PencilBrush(canvas);
    canvas.freeDrawingBrush.color = SM_EDITOR.background;
    canvas.freeDrawingBrush.width = SM_EDITOR.eraserBrushWidth;
    canvas.freeDrawingBrush.strokeLineCap = "round";
    canvas.freeDrawingBrush.strokeLineJoin = "round";
    return;
  }

  canvas.defaultCursor = "default";
  canvas.hoverCursor = "move";
  canvas.moveCursor = "move";
  canvas.isDrawingMode = false;
  canvas.selection = activeTool === "select";
  if (activeTool !== "select") {
    canvas.discardActiveObject();
  }
}

export function createEraserStrokeFromPath(path: Path): EraserStrokeObject {
  return {
    id: crypto.randomUUID(),
    type: "eraserStroke",
    x: path.left ?? 0,
    y: path.top ?? 0,
    rotation: path.angle ?? 0,
    scaleX: 1,
    scaleY: 1,
    path: (path.path ?? []) as TComplexPathData,
    strokeWidth: SM_EDITOR.eraserBrushWidth,
  };
}

export function attachEraserStrokeMetadata(path: Path, stroke: EraserStrokeObject) {
  path.set({
    ...ERASER_STROKE_PROPS,
    strokeWidth: stroke.strokeWidth,
    scaleX: 1,
    scaleY: 1,
  });
  attachExtendedData(path, stroke);
  setFloorplanMeta(path, { floorplanId: stroke.id, floorplanType: stroke.type });
}

export function getEraserCursorMetrics(
  canvas: Canvas,
  wrapper: HTMLElement,
  event: { clientX: number; clientY: number },
) {
  const upperCanvas = canvas.upperCanvasEl;
  const canvasRect = upperCanvas.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();
  const cssScale = canvasRect.width / canvas.width;

  return {
    x: canvasRect.left - wrapperRect.left + (event.clientX - canvasRect.left),
    y: canvasRect.top - wrapperRect.top + (event.clientY - canvasRect.top),
    size: SM_EDITOR.eraserBrushWidth * cssScale,
  };
}

export type FloorplanFabricMeta = {
  floorplanId: string;
  floorplanType: FloorplanObject["type"];
};

export function setFloorplanMeta(object: FabricObject, meta: FloorplanFabricMeta) {
  object.set("data", meta);
}

export function getFloorplanMeta(object: FabricObject): FloorplanFabricMeta | null {
  const data = object.get("data") as Partial<FloorplanFabricMeta> | undefined;
  if (!data?.floorplanId || !data.floorplanType) {
    return null;
  }
  return {
    floorplanId: data.floorplanId,
    floorplanType: data.floorplanType,
  };
}

/** Sudda under övrigt innehåll; symboler och möbler högst upp. */
function getFloorplanObjectLayer(type: FloorplanObjectType): number {
  switch (type) {
    case "eraserStroke":
      return 0;
    case "symbol":
    case "furniture":
      return 2;
    default:
      return 1;
  }
}

export function sortFloorplanObjectsByLayer(objects: FloorplanObject[]): FloorplanObject[] {
  return objects
    .map((object, index) => ({ object, index }))
    .sort((a, b) => {
      const layerDiff =
        getFloorplanObjectLayer(a.object.type) - getFloorplanObjectLayer(b.object.type);
      if (layerDiff !== 0) {
        return layerDiff;
      }
      return a.index - b.index;
    })
    .map(({ object }) => object);
}

export function applyCanvasLayerOrder(canvas: Canvas) {
  const stacked = canvas
    .getObjects()
    .filter((object) => !object.get(FLOORPLAN_BACKGROUND_KEY) && !object.get(FLOORPLAN_GUIDE_KEY));

  const sorted = [...stacked].sort((a, b) => {
    const metaA = getFloorplanMeta(a);
    const metaB = getFloorplanMeta(b);
    const layerA = metaA ? getFloorplanObjectLayer(metaA.floorplanType) : 1;
    const layerB = metaB ? getFloorplanObjectLayer(metaB.floorplanType) : 1;
    if (layerA !== layerB) {
      return layerA - layerB;
    }
    return stacked.indexOf(a) - stacked.indexOf(b);
  });

  sorted.forEach((object, index) => {
    canvas.moveObjectTo(object, index + 1);
  });
  // The guide lines stay on top of everything.
  canvas.getObjects().filter((object) => object.get(FLOORPLAN_GUIDE_KEY)).forEach((line) => canvas.bringObjectToFront(line));
}

function createPathGroup(
  paths: string[],
  width: number,
  height: number,
  stroke: string,
  fill: string,
): Group {
  const items = paths.map(
    (pathData) =>
      new Path(pathData, {
        fill,
        stroke,
        strokeWidth: 2,
        strokeUniform: true,
        originX: "left",
        originY: "top",
      }),
  );

  const group = new Group(items, {
    originX: "left",
    originY: "top",
  });
  // The drawing, not its 48-unit design box, fills the object's size, so a 0.6 m stove is
  // 0.6 m wide on the plan.
  group.scaleX = width / Math.max(group.width, 1);
  group.scaleY = height / Math.max(group.height, 1);
  return group;
}

/**
 * Symbols and furniture: the scaled drawing inside an outer group. The outer group carries
 * the object's own position and transform, so resizing it on the canvas round-trips like any
 * other object instead of being overwritten by the drawing's scale.
 */
function createSymbolGroup(object: SymbolObject | FurnitureObject, paths: string[], common: Partial<FabricObject>) {
  const group = new Group([createPathGroup(paths, object.width, object.height, object.stroke, object.fill)], common);
  setFloorplanMeta(group, { floorplanId: object.id, floorplanType: object.type });
  return group;
}

export function createFabricObjectFromFloorplan(object: FloorplanObject): FabricObject {
  const common = {
    left: object.x,
    top: object.y,
    angle: object.rotation,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    selectable: !object.locked,
    evented: !object.locked,
    visible: object.visible ?? true,
    originX: "left" as const,
    originY: "top" as const,
    strokeUniform: true,
    ...FLOORPLAN_SELECTION_PROPS,
    data: {
      floorplanId: object.id,
      floorplanType: object.type,
    } satisfies FloorplanFabricMeta,
  };

  switch (object.type) {
    case "wall":
      return new Line([object.x, object.y, object.x2, object.y2], {
        ...common,
        // A line is placed by its bounding box, which starts at its smallest x and y — not at its
        // first point, which is only the same thing for a line drawn down and to the right.
        // Scanned walls run every way.
        left: Math.min(object.x, object.x2),
        top: Math.min(object.y, object.y2),
        stroke: SM_INK,
        strokeWidth: object.strokeWidth,
        strokeLineCap: "square",
        controls: createWallControls(),
      });

    case "roomLabel":
      return new FabricText(object.text, {
        ...common,
        fontFamily: object.fontFamily,
        fontSize: object.fontSize,
        fill: object.fill,
        textAlign: object.textAlign,
      });

    case "dimension": {
      const midX = (object.x + object.x2) / 2;
      const midY = (object.y + object.y2) / 2;
      const angle = (Math.atan2(object.y2 - object.y, object.x2 - object.x) * 180) / Math.PI;
      const line = new Line([object.x, object.y, object.x2, object.y2], {
        stroke: SM_INK,
        strokeWidth: object.strokeWidth,
        selectable: false,
        evented: false,
      });
      const label = new FabricText(object.label, {
        left: midX,
        top: midY - 14,
        fontFamily: SM_EDITOR.dimensionFontFamily,
        fontSize: object.fontSize,
        fill: SM_INK,
        textAlign: "center",
        originX: "center",
        originY: "bottom",
        angle,
        selectable: false,
        evented: false,
      });
      const group = new Group([line, label], common);
      setFloorplanMeta(group, { floorplanId: object.id, floorplanType: object.type });
      return group;
    }

    case "door": {
      const arc = new Path(`M 0 0 L 0 ${-object.width} A ${object.width} ${object.width} 0 0 ${object.swing === "right" ? 1 : 0} ${object.swing === "right" ? object.width : -object.width} 0`, {
        fill: "transparent",
        stroke: SM_INK,
        strokeWidth: object.strokeWidth,
        left: 0,
        top: 0,
      });
      const jamb = new Line([0, 0, object.width, 0], {
        stroke: SM_INK,
        strokeWidth: object.strokeWidth,
        left: 0,
        top: 0,
      });
      const group = new Group([jamb, arc], common);
      setFloorplanMeta(group, { floorplanId: object.id, floorplanType: object.type });
      return group;
    }

    case "window": {
      const stroke = 1;
      const height = object.height ?? 14;
      const width = object.width;
      const innerHeight = Math.max(height - stroke * 2, stroke * 2 + 2);
      const paneHeight = Math.max((innerHeight - stroke) / 2, 1);
      const dividerY = stroke + paneHeight + stroke / 2;

      const topPane = new Rect({
        left: stroke,
        top: stroke,
        width: width - stroke * 2,
        height: paneHeight,
        fill: "#ffffff",
        stroke: null,
        originX: "left",
        originY: "top",
      });
      const bottomPane = new Rect({
        left: stroke,
        top: stroke + paneHeight + stroke,
        width: width - stroke * 2,
        height: paneHeight,
        fill: "#ffffff",
        stroke: null,
        originX: "left",
        originY: "top",
      });
      const border = new Rect({
        left: 0,
        top: 0,
        width,
        height,
        fill: "transparent",
        stroke: SM_INK,
        strokeWidth: stroke,
        strokeUniform: true,
        originX: "left",
        originY: "top",
      });
      const divider = new Line([stroke / 2, dividerY, width - stroke / 2, dividerY], {
        stroke: SM_INK,
        strokeWidth: stroke,
        strokeUniform: true,
      });
      const group = new Group([topPane, bottomPane, border, divider], common);
      setFloorplanMeta(group, { floorplanId: object.id, floorplanType: object.type });
      return group;
    }

    case "stair": {
      const steps = 6;
      const stepHeight = object.height / steps;
      const lines = Array.from({ length: steps }, (_, index) => {
        const y = index * stepHeight;
        return new Line([0, y, object.width, y], {
          stroke: SM_INK,
          strokeWidth: object.strokeWidth,
        });
      });
      const border = new Rect({
        width: object.width,
        height: object.height,
        fill: "transparent",
        stroke: SM_INK,
        strokeWidth: object.strokeWidth,
      });
      const arrow = new Line(
        object.direction === "up"
          ? [object.width / 2, object.height - 8, object.width / 2, 8]
          : [object.width / 2, 8, object.width / 2, object.height - 8],
        {
          stroke: SM_INK,
          strokeWidth: object.strokeWidth,
        },
      );
      const group = new Group([border, ...lines, arrow], common);
      setFloorplanMeta(group, { floorplanId: object.id, floorplanType: object.type });
      return group;
    }

    case "symbol": {
      const definition = getSymbolById(object.symbolId);
      return createSymbolGroup(object, definition?.paths ?? ["M4 4 h40 v40 h-40 Z"], common);
    }

    case "icon": {
      const circle = new Circle({
        radius: object.size / 2,
        fill: object.fill,
        stroke: SM_INK,
        strokeWidth: 1.5,
        originX: "center",
        originY: "center",
        left: object.size / 2,
        top: object.size / 2,
      });
      const group = new Group([circle], {
        ...common,
        width: object.size,
        height: object.size,
      });
      setFloorplanMeta(group, { floorplanId: object.id, floorplanType: object.type });
      return group;
    }

    case "furniture": {
      const definition = getFurnitureById(object.furnitureId);
      return createSymbolGroup(object, definition?.paths ?? ["M4 4 h40 v24 h-40 Z"], common);
    }

    case "eraserStroke":
      return new Path(object.path, {
        ...common,
        ...ERASER_STROKE_PROPS,
        strokeWidth: object.strokeWidth,
      });

    default:
      return new Rect({
        ...common,
        width: 40,
        height: 40,
        fill: "transparent",
        stroke: SM_INK,
      });
  }
}

export function floorplanObjectFromFabric(object: FabricObject): FloorplanObject | null {
  const meta = getFloorplanMeta(object);
  if (!meta) {
    return null;
  }

  const base = {
    id: meta.floorplanId,
    type: meta.floorplanType,
    x: object.left ?? 0,
    y: object.top ?? 0,
    rotation: object.angle ?? 0,
    scaleX: object.scaleX ?? 1,
    scaleY: object.scaleY ?? 1,
    locked: !object.selectable,
    visible: object.visible ?? true,
  };

  switch (meta.floorplanType) {
    case "wall": {
      if (!(object instanceof Line)) {
        return null;
      }
      // The ends relative to the bounding box's corner, whichever way the line runs.
      const coords = object.calcLinePoints();
      const left = object.left ?? 0;
      const top = object.top ?? 0;
      const minX = Math.min(coords.x1, coords.x2);
      const minY = Math.min(coords.y1, coords.y2);
      const stored = object.get(FLOORPLAN_DATA_KEY) as FloorplanObject | undefined;
      return {
        ...base,
        type: "wall",
        x: left + (coords.x1 - minX),
        y: top + (coords.y1 - minY),
        x2: left + (coords.x2 - minX),
        y2: top + (coords.y2 - minY),
        strokeWidth: object.strokeWidth ?? SM_EDITOR.wallStroke,
        ...(stored?.type === "wall" && stored.wallId ? { wallId: stored.wallId } : {}),
      };
    }
    case "roomLabel": {
      if (!(object instanceof FabricText)) {
        return null;
      }
      const stored = object.get(FLOORPLAN_DATA_KEY) as FloorplanObject | undefined;
      return {
        ...base,
        type: "roomLabel",
        text: object.text ?? "",
        fontSize: object.fontSize ?? 18,
        fontFamily: object.fontFamily ?? SM_EDITOR.roomLabelFontFamily,
        fill: typeof object.fill === "string" ? object.fill : SM_INK,
        textAlign: (object.textAlign as "left" | "center" | "right") ?? "center",
        // The room's scanned area is not on the canvas; it comes from the stored object.
        ...(stored?.type === "roomLabel" && stored.areaM2 !== undefined ? { areaM2: stored.areaM2 } : {}),
      };
    }
    case "dimension":
    case "door":
    case "stair":
    case "symbol":
    case "icon":
    case "furniture":
    case "eraserStroke":
      // Preserve original typed fields via custom property round-trip.
      return readExtendedObject(object, base);
    case "window": {
      const stored = readExtendedObject(object, base);
      if (!stored || stored.type !== "window") {
        return null;
      }
      const windowObject = stored;
      return {
        ...windowObject,
        ...base,
        type: "window",
        // The stored size times any resize on the canvas: measuring the drawn group instead
        // lost a pixel to its frame and rounding on every save.
        width: Math.max(windowObject.width * (object.scaleX ?? 1), 1),
        height: Math.max((windowObject.height ?? 14) * (object.scaleY ?? 1), 1),
        scaleX: 1,
        scaleY: 1,
      };
    }
    default:
      return null;
  }
}

type PartialBase = {
  id: string;
  type: FloorplanObject["type"];
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  locked?: boolean;
  visible?: boolean;
};

/** The plan object a canvas object was drawn from, as last stored on it. */
export function getStoredFloorplanObject(object: FabricObject) {
  return object.get(FLOORPLAN_DATA_KEY) as FloorplanObject | undefined;
}

function readExtendedObject(object: FabricObject, base: PartialBase): FloorplanObject | null {
  const stored = object.get(FLOORPLAN_DATA_KEY) as FloorplanObject | undefined;
  if (!stored) {
    return null;
  }

  return {
    ...stored,
    ...base,
    type: stored.type,
  } as FloorplanObject;
}

/**
 * Dragging one piece of a scanned wall drags the wall's other pieces and its doors and windows
 * by the same amount. Only plain moves count; rotating or stretching a piece moves nothing else.
 */
export function moveAttachedObjects(
  canvas: Canvas,
  target: FabricObject | undefined,
  action: string | undefined,
  originalPosition: { left: number; top: number } | undefined,
) {
  const stored = target?.get(FLOORPLAN_DATA_KEY) as FloorplanObject | undefined;
  if (!target || action !== "drag" || !originalPosition || stored?.type !== "wall" || !stored.wallId) {
    return;
  }

  const dx = (target.left ?? 0) - originalPosition.left;
  const dy = (target.top ?? 0) - originalPosition.top;
  if (dx === 0 && dy === 0) {
    return;
  }

  for (const other of canvas.getObjects()) {
    const data = other.get(FLOORPLAN_DATA_KEY) as FloorplanObject | undefined;
    if (other === target || !data || !("wallId" in data) || data.wallId !== stored.wallId) {
      continue;
    }
    other.set({ left: (other.left ?? 0) + dx, top: (other.top ?? 0) + dy });
    other.setCoords();
  }
}

export function attachExtendedData(object: FabricObject, source: FloorplanObject) {
  object.set(FLOORPLAN_DATA_KEY, source);
}

export async function renderDocumentToCanvas(
  canvas: Canvas,
  document: FloorplanDocument,
  backgroundUrl: string,
) {
  const background = await loadFloorplanBackgroundImage(backgroundUrl);
  if (!isCanvasOperational(canvas)) {
    return;
  }

  background.set({
    left: 0,
    top: 0,
    selectable: false,
    evented: false,
    hasControls: false,
    lockMovementX: true,
    lockMovementY: true,
    originX: "left",
    originY: "top",
  });
  background.set(FLOORPLAN_BACKGROUND_KEY, true);

  if (background.width && background.height) {
    background.scaleX = document.canvas.width / background.width;
    background.scaleY = document.canvas.height / background.height;
  }

  const fabricObjects = sortFloorplanObjectsByLayer(document.objects).map((object) => {
    const fabricObject = createFabricObjectFromFloorplan(object);
    attachExtendedData(fabricObject, object);
    return fabricObject;
  });

  canvas.clear();
  canvas.clipPath = undefined;
  canvas.backgroundColor = SM_EDITOR.background;
  canvas.add(background);
  canvas.sendObjectToBack(background);

  for (const fabricObject of fabricObjects) {
    canvas.add(fabricObject);
  }

  canvas.requestRenderAll();
}

export function syncCanvasToDocument(canvas: Canvas, document: FloorplanDocument): FloorplanDocument {
  const objects = canvas
    .getObjects()
    .filter((object) => !object.get(FLOORPLAN_BACKGROUND_KEY) && !object.get(FLOORPLAN_GUIDE_KEY))
    .map((object) => floorplanObjectFromFabric(object))
    .filter((object): object is FloorplanObject => object !== null);

  return {
    ...document,
    objects: sortFloorplanObjectsByLayer(objects),
    meta: {
      ...document.meta,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function duplicateFabricObject(object: FabricObject): FabricObject | null {
  const meta = getFloorplanMeta(object);
  const stored = object.get(FLOORPLAN_DATA_KEY) as FloorplanObject | undefined;
  if (!meta || !stored) {
    return null;
  }

  // A copy is its own object, not another piece of the scanned wall it came from.
  const { wallId: _wallId, ...unattached } = stored as FloorplanObject & { wallId?: string };
  void _wallId;
  const copy = unattached as FloorplanObject;
  const clone = createFabricObjectFromFloorplan({
    ...copy,
    id: crypto.randomUUID(),
    x: copy.x + 16,
    y: copy.y + 16,
  });
  attachExtendedData(clone, {
    ...copy,
    id: (clone.get("data") as FloorplanFabricMeta).floorplanId,
    x: copy.x + 16,
    y: copy.y + 16,
  });
  return clone;
}

export function applyPropertiesToFabricObject(object: FabricObject, patch: Partial<FloorplanObject>) {
  const stored = object.get(FLOORPLAN_DATA_KEY) as FloorplanObject | undefined;
  if (!stored) {
    return null;
  }

  const next = {
    ...stored,
    ...patch,
    id: stored.id,
    type: stored.type,
  } as FloorplanObject;

  const recreated = createFabricObjectFromFloorplan(next);
  attachExtendedData(recreated, next);
  return recreated;
}

export function isSymbolObject(object: FloorplanObject): object is SymbolObject {
  return object.type === "symbol";
}

export function isFurnitureObject(object: FloorplanObject): object is FurnitureObject {
  return object.type === "furniture";
}

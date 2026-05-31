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
import { CANVA_PURPLE, CANVA_SELECTION_PROPS } from "@/lib/floorplan/fabric/canva-controls";

const FLOORPLAN_DATA_KEY = "floorplan";
const FLOORPLAN_BACKGROUND_KEY = "floorplan-background";

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
  strokeLineCap: "square" as const,
  strokeLineJoin: "miter" as const,
  selectable: false,
  evented: false,
};

export function configureCanvasSelectionStyle(canvas: Canvas) {
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
    canvas.freeDrawingBrush.strokeLineCap = "square";
    canvas.freeDrawingBrush.strokeLineJoin = "miter";
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
    .filter((object) => !object.get(FLOORPLAN_BACKGROUND_KEY));

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
}

function createPathGroup(
  paths: string[],
  width: number,
  height: number,
  stroke: string,
  fill: string,
): Group {
  const scaleX = width / 48;
  const scaleY = height / 48;
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
  group.scaleX = scaleX;
  group.scaleY = scaleY;
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
        stroke: SM_INK,
        strokeWidth: object.strokeWidth,
        strokeLineCap: "square",
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
      const paths = definition?.paths ?? ["M4 4 h40 v40 h-40 Z"];
      const group = createPathGroup(paths, object.width, object.height, object.stroke, object.fill);
      group.set({
        ...common,
        data: {
          floorplanId: object.id,
          floorplanType: object.type,
        },
      });
      return group;
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
      const paths = definition?.paths ?? ["M4 4 h40 v24 h-40 Z"];
      const group = createPathGroup(paths, object.width, object.height, object.stroke, object.fill);
      group.set({
        ...common,
        data: {
          floorplanId: object.id,
          floorplanType: object.type,
        },
      });
      return group;
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
      const coords = object.calcLinePoints();
      return {
        ...base,
        type: "wall",
        x2: (object.left ?? 0) + (coords.x2 - coords.x1),
        y2: (object.top ?? 0) + (coords.y2 - coords.y1),
        strokeWidth: object.strokeWidth ?? SM_EDITOR.wallStroke,
      };
    }
    case "roomLabel": {
      if (!(object instanceof FabricText)) {
        return null;
      }
      return {
        ...base,
        type: "roomLabel",
        text: object.text ?? "",
        fontSize: object.fontSize ?? 18,
        fontFamily: object.fontFamily ?? SM_EDITOR.roomLabelFontFamily,
        fill: typeof object.fill === "string" ? object.fill : SM_INK,
        textAlign: (object.textAlign as "left" | "center" | "right") ?? "center",
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
        width: Math.max(Math.round(object.getScaledWidth()), 1),
        height: Math.max(Math.round(object.getScaledHeight()), 1),
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

export function attachExtendedData(object: FabricObject, source: FloorplanObject) {
  object.set(FLOORPLAN_DATA_KEY, source);
}

export async function renderDocumentToCanvas(
  canvas: Canvas,
  document: FloorplanDocument,
  backgroundUrl: string,
) {
  const background = await loadFloorplanBackgroundImage(backgroundUrl);
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
    .filter((object) => !object.get(FLOORPLAN_BACKGROUND_KEY))
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

  const clone = createFabricObjectFromFloorplan({
    ...stored,
    id: crypto.randomUUID(),
    x: stored.x + 16,
    y: stored.y + 16,
  });
  attachExtendedData(clone, {
    ...stored,
    id: (clone.get("data") as FloorplanFabricMeta).floorplanId,
    x: stored.x + 16,
    y: stored.y + 16,
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

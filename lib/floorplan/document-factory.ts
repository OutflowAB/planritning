import {
  FLOORPLAN_DOCUMENT_VERSION,
  createDefaultTransform,
  createObjectId,
  type FloorplanDocument,
  type FloorplanObject,
} from "@/lib/floorplan/types";
import { roomLabelFontSize, SM_EDITOR, SM_ICON_STROKE, SM_INK, SM_ROOM_LABEL_FONT } from "@/lib/sm-floorplan-layout";

type CreateDocumentInput = {
  imageId: number;
  imagePath: string;
  fileName: string;
  canvasWidth: number;
  canvasHeight: number;
};

export function createEmptyDocument(input: CreateDocumentInput): FloorplanDocument {
  const now = new Date().toISOString();

  return {
    version: FLOORPLAN_DOCUMENT_VERSION,
    canvas: {
      width: input.canvasWidth,
      height: input.canvasHeight,
    },
    meta: {
      imageId: input.imageId,
      imagePath: input.imagePath,
      fileName: input.fileName,
      createdAt: now,
      updatedAt: now,
    },
    objects: [],
  };
}

export function cloneDocument(document: FloorplanDocument): FloorplanDocument {
  return structuredClone(document);
}

export function touchDocument(document: FloorplanDocument): FloorplanDocument {
  return {
    ...document,
    meta: {
      ...document.meta,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function createDefaultWall(x: number, y: number): FloorplanObject {
  return {
    id: createObjectId(),
    type: "wall",
    ...createDefaultTransform(x, y),
    x2: x + 120,
    y2: y,
    strokeWidth: SM_EDITOR.wallStroke,
  };
}

export function createDefaultRoomLabel(
  x: number,
  y: number,
  canvasWidth: number,
  text = "RUM",
): FloorplanObject {
  return {
    id: createObjectId(),
    type: "roomLabel",
    ...createDefaultTransform(x, y),
    text,
    fontSize: roomLabelFontSize(canvasWidth),
    fontFamily: SM_ROOM_LABEL_FONT,
    fill: SM_INK,
    textAlign: "center",
  };
}

export function createDefaultDimension(x: number, y: number): FloorplanObject {
  return {
    id: createObjectId(),
    type: "dimension",
    ...createDefaultTransform(x, y),
    x2: x + 100,
    y2: y,
    label: "3,2 m",
    fontSize: 12,
    strokeWidth: SM_EDITOR.dimensionStroke,
  };
}

/** `sizeScale` fits the default to the canvas; see defaultObjectScale. */
export function createDefaultDoor(x: number, y: number, sizeScale = 1): FloorplanObject {
  return {
    id: createObjectId(),
    type: "door",
    ...createDefaultTransform(x, y),
    width: 80 * sizeScale,
    swing: "right",
    strokeWidth: SM_ICON_STROKE,
  };
}

export function createDefaultWindow(x: number, y: number, sizeScale = 1): FloorplanObject {
  return {
    id: createObjectId(),
    type: "window",
    ...createDefaultTransform(x, y),
    width: 67 * sizeScale,
    height: 14 * sizeScale,
    strokeWidth: SM_EDITOR.dimensionStroke,
  };
}

export function createDefaultStair(x: number, y: number, sizeScale = 1): FloorplanObject {
  return {
    id: createObjectId(),
    type: "stair",
    ...createDefaultTransform(x, y),
    width: 80 * sizeScale,
    height: 120 * sizeScale,
    direction: "up",
    strokeWidth: SM_ICON_STROKE,
  };
}

export function createDefaultSymbol(
  x: number,
  y: number,
  symbolId: string,
  width: number,
  height: number,
): FloorplanObject {
  return {
    id: createObjectId(),
    type: "symbol",
    ...createDefaultTransform(x, y),
    symbolId,
    width,
    height,
    fill: "transparent",
    stroke: SM_INK,
  };
}

export function createDefaultFurniture(
  x: number,
  y: number,
  furnitureId: string,
  width: number,
  height: number,
): FloorplanObject {
  return {
    id: createObjectId(),
    type: "furniture",
    ...createDefaultTransform(x, y),
    furnitureId,
    width,
    height,
    fill: "transparent",
    stroke: SM_INK,
  };
}

export async function inferCanvasSizeFromImageUrl(imageUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      reject(new Error("Kunde inte läsa bildens storlek."));
    };
    image.src = imageUrl;
  });
}

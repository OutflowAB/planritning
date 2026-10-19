import type { TComplexPathData } from "fabric";

export const FLOORPLAN_DOCUMENT_VERSION = 1 as const;

export type FloorplanObjectType =
  | "wall"
  | "roomLabel"
  | "dimension"
  | "door"
  | "window"
  | "stair"
  | "symbol"
  | "icon"
  | "furniture"
  | "eraserStroke";

export type FloorplanTransform = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
};

export type FloorplanObjectBase = FloorplanTransform & {
  id: string;
  type: FloorplanObjectType;
  locked?: boolean;
  visible?: boolean;
};

/**
 * Shared by the pieces of one scanned wall and the doors and windows in it. Hand-drawn objects
 * have none.
 */
type AttachedToWall = { wallId?: string };

export type WallObject = FloorplanObjectBase & AttachedToWall & {
  type: "wall";
  x2: number;
  y2: number;
  strokeWidth: number;
};

export type RoomLabelObject = FloorplanObjectBase & {
  type: "roomLabel";
  text: string;
  fontSize: number;
  fontFamily: string;
  fill: string;
  textAlign: "left" | "center" | "right";
  /** Floor area of the room from its scanned outline. Never drawn. */
  areaM2?: number;
};

export type DimensionObject = FloorplanObjectBase & {
  type: "dimension";
  x2: number;
  y2: number;
  label: string;
  fontSize: number;
  strokeWidth: number;
};

export type DoorObject = FloorplanObjectBase & AttachedToWall & {
  type: "door";
  width: number;
  swing: "left" | "right";
  strokeWidth: number;
};

export type WindowObject = FloorplanObjectBase & AttachedToWall & {
  type: "window";
  width: number;
  height: number;
  strokeWidth: number;
};

export type StairObject = FloorplanObjectBase & {
  type: "stair";
  width: number;
  height: number;
  direction: "up" | "down";
  strokeWidth: number;
};

export type SymbolObject = FloorplanObjectBase & {
  type: "symbol";
  symbolId: string;
  width: number;
  height: number;
  fill: string;
  stroke: string;
};

export type IconObject = FloorplanObjectBase & {
  type: "icon";
  iconId: string;
  size: number;
  fill: string;
};

export type FurnitureObject = FloorplanObjectBase & {
  type: "furniture";
  furnitureId: string;
  width: number;
  height: number;
  fill: string;
  stroke: string;
};

export type EraserStrokeObject = FloorplanObjectBase & {
  type: "eraserStroke";
  path: TComplexPathData;
  strokeWidth: number;
};

export type FloorplanObject =
  | WallObject
  | RoomLabelObject
  | DimensionObject
  | DoorObject
  | WindowObject
  | StairObject
  | SymbolObject
  | IconObject
  | FurnitureObject
  | EraserStrokeObject;

export type FloorplanCanvasMeta = {
  width: number;
  height: number;
};

export type FloorplanDocumentMeta = {
  imageId: number;
  imagePath: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
};

/** Real-world size of the drawing. Only plans made from a scan have one. */
export type FloorplanScale = {
  pxPerMeter: number;
};

/** Where on the canvas the plan itself is drawn, in canvas pixels. Only blank and scanned plans have one. */
export type FloorplanDrawingArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FloorplanDocument = {
  version: typeof FLOORPLAN_DOCUMENT_VERSION;
  canvas: FloorplanCanvasMeta;
  meta: FloorplanDocumentMeta;
  scale?: FloorplanScale;
  drawingArea?: FloorplanDrawingArea;
  objects: FloorplanObject[];
  /**
   * Help lines for the person editing, in canvas pixels [x1, y1, x2, y2]. Drawn in the editor
   * only: never saved as objects, exported or published.
   */
  guides?: { meshWindows?: Array<[number, number, number, number]> };
};

export type EditorTool =
  | "select"
  | "eraser"
  | "wall"
  | "roomLabel"
  | "dimension"
  | "door"
  | "window"
  | "stair"
  | "symbol"
  | "furniture";

export type FloorplanSymbolDefinition = {
  id: string;
  label: string;
  category: "badrum" | "kök" | "el" | "övrigt";
  defaultWidth: number;
  defaultHeight: number;
  paths: string[];
  /** Abbreviation written in the box (K/F, DM…). The scan import keeps such boxes upright. */
  text?: string;
};

export type FurnitureDefinition = {
  id: string;
  label: string;
  defaultWidth: number;
  defaultHeight: number;
  paths: string[];
};

export function createObjectId() {
  return crypto.randomUUID();
}

export function createDefaultTransform(x = 0, y = 0): FloorplanTransform {
  return {
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

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
  | "furniture";

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

export type WallObject = FloorplanObjectBase & {
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
};

export type DimensionObject = FloorplanObjectBase & {
  type: "dimension";
  x2: number;
  y2: number;
  label: string;
  fontSize: number;
  strokeWidth: number;
};

export type DoorObject = FloorplanObjectBase & {
  type: "door";
  width: number;
  swing: "left" | "right";
  strokeWidth: number;
};

export type WindowObject = FloorplanObjectBase & {
  type: "window";
  width: number;
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

export type FloorplanObject =
  | WallObject
  | RoomLabelObject
  | DimensionObject
  | DoorObject
  | WindowObject
  | StairObject
  | SymbolObject
  | IconObject
  | FurnitureObject;

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

export type FloorplanDocument = {
  version: typeof FLOORPLAN_DOCUMENT_VERSION;
  canvas: FloorplanCanvasMeta;
  meta: FloorplanDocumentMeta;
  objects: FloorplanObject[];
};

export type EditorTool =
  | "select"
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

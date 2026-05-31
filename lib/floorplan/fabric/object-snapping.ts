import { AligningGuidelines } from "fabric/extensions";
import type { Canvas, FabricObject } from "fabric";

import type { FloorplanObject } from "@/lib/floorplan/types";
import { getFloorplanMeta } from "@/lib/floorplan/fabric/sync";

const FLOORPLAN_BACKGROUND_KEY = "floorplan-background";
export const FLOORPLAN_SNAP_MARGIN = 8;

function isSnapReferenceObject(object: FabricObject, target?: FabricObject) {
  if (!object.visible) {
    return false;
  }
  if (object.get(FLOORPLAN_BACKGROUND_KEY)) {
    return false;
  }
  if (target && object === target) {
    return false;
  }
  return getFloorplanMeta(object) !== null;
}

function getSnapReferenceObjects(canvas: Canvas, target?: FabricObject) {
  const objects = new Set<FabricObject>();
  canvas.forEachObject((object) => {
    if (isSnapReferenceObject(object, target)) {
      objects.add(object);
    }
  });
  return objects;
}

function collectReferenceValues(objects: Iterable<FabricObject>, axis: "x" | "y") {
  const values: number[] = [];
  for (const object of objects) {
    object.setCoords();
    const rect = object.getBoundingRect();
    if (axis === "x") {
      values.push(rect.left, rect.left + rect.width, rect.left + rect.width / 2);
    } else {
      values.push(rect.top, rect.top + rect.height, rect.top + rect.height / 2);
    }
  }
  return values;
}

function findBestAxisSnap(values: number[], references: number[], margin: number) {
  let bestDelta = 0;
  let bestDistance = margin + 1;

  for (const value of values) {
    for (const reference of references) {
      const delta = reference - value;
      const distance = Math.abs(delta);
      if (distance <= margin && distance < bestDistance) {
        bestDistance = distance;
        bestDelta = delta;
      }
    }
  }

  return bestDistance <= margin ? bestDelta : 0;
}

export function getObjectSnapSize(object: FloorplanObject): { width: number; height: number } | null {
  switch (object.type) {
    case "window":
      return { width: object.width, height: object.height };
    case "door":
      return { width: object.width, height: object.width };
    case "stair":
    case "symbol":
    case "furniture":
      return { width: object.width, height: object.height };
    case "roomLabel":
      return {
        width: Math.max(object.text.length * object.fontSize * 0.55, 24),
        height: object.fontSize + 8,
      };
    case "dimension":
      return {
        width: Math.max(Math.abs(object.x2 - object.x), 1),
        height: Math.max(Math.abs(object.y2 - object.y), 16),
      };
    default:
      return null;
  }
}

export function snapPlacementPoint(
  canvas: Canvas,
  point: { x: number; y: number },
  size: { width: number; height: number },
  margin = FLOORPLAN_SNAP_MARGIN,
) {
  const references = getSnapReferenceObjects(canvas);
  if (references.size === 0) {
    return point;
  }

  const { width, height } = size;
  const xValues = [point.x, point.x + width, point.x + width / 2];
  const yValues = [point.y, point.y + height, point.y + height / 2];

  const dx = findBestAxisSnap(xValues, collectReferenceValues(references, "x"), margin);
  const dy = findBestAxisSnap(yValues, collectReferenceValues(references, "y"), margin);

  return {
    x: point.x + dx,
    y: point.y + dy,
  };
}

export function snapFloorplanObjectPosition(canvas: Canvas, object: FloorplanObject): FloorplanObject {
  const size = getObjectSnapSize(object);
  if (!size) {
    return object;
  }

  const snapped = snapPlacementPoint(canvas, { x: object.x, y: object.y }, size);
  if (snapped.x === object.x && snapped.y === object.y) {
    return object;
  }

  const dx = snapped.x - object.x;
  const dy = snapped.y - object.y;

  if (object.type === "wall" || object.type === "dimension") {
    return {
      ...object,
      x: snapped.x,
      y: snapped.y,
      x2: object.x2 + dx,
      y2: object.y2 + dy,
    };
  }

  return {
    ...object,
    x: snapped.x,
    y: snapped.y,
  };
}

export function installObjectSnapping(canvas: Canvas) {
  return new AligningGuidelines(canvas, {
    margin: FLOORPLAN_SNAP_MARGIN,
    color: "rgba(92, 84, 74, 0.85)",
    width: 1,
    getObjectsByTarget(target) {
      return getSnapReferenceObjects(canvas, target);
    },
  });
}

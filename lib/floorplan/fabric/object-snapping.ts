import { AligningGuidelines } from "fabric/extensions";
import { Line, type Canvas, type FabricObject, type Transform } from "fabric";

import type { FloorplanObject } from "@/lib/floorplan/types";
import { canvasPixels } from "@/lib/floorplan/fabric/canva-controls";
import { getFloorplanMeta, getStoredFloorplanObject } from "@/lib/floorplan/fabric/sync";
import { high, low, snapBoxToFixtures, snapStretchedSide, type SnapBox } from "@/lib/floorplan/snap-box";
import { getSymbolById, STRETCHABLE_SYMBOL_IDS } from "@/lib/floorplan/symbol-library";

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

const COUNTER_ID = "bankskiva";
const FIXTURE_SNAP_SCREEN_PIXELS = 12;

function isSquareToCanvas(object: FabricObject) {
  const angle = (((object.angle ?? 0) % 90) + 90) % 90;
  return angle < 0.5 || angle > 89.5;
}

function boxOf(object: FabricObject): SnapBox {
  object.setCoords();
  const { left, top, width, height } = object.getBoundingRect();
  return { left, top, right: left + width, bottom: top + height };
}

/** The walls running straight across or down the plan, whose line has no height or no width. */
function straightWalls(canvas: Canvas) {
  const walls: SnapBox[] = [];
  canvas.forEachObject((object) => {
    const stored = getStoredFloorplanObject(object);
    if (stored?.type === "wall" && object.visible && object instanceof Line && isSquareToCanvas(object) && Math.min(object.width, object.height) < 0.5) {
      walls.push(boxOf(object));
    }
  });
  return walls;
}

/**
 * While a counter or wardrobe is stretched by a side handle: the side being pulled stops at the
 * face of a wall it comes close to.
 */
export function snapStretchToWalls(canvas: Canvas, target: FabricObject, transform: Transform) {
  const stored = getStoredFloorplanObject(target);
  const side = transform.corner;
  if (stored?.type !== "symbol" || !STRETCHABLE_SYMBOL_IDS.has(stored.symbolId) || !isSquareToCanvas(target)) return;
  if (!["ml", "mr", "mt", "mb"].includes(side)) return;

  // The box's own width runs down the plan when it is turned a quarter.
  const ownWidth = side === "ml" || side === "mr";
  const turned = Math.abs(Math.round((target.angle ?? 0) / 90)) % 2 === 1;
  const axis = ownWidth !== turned ? 0 : 1;
  const { originX, originY } = transform;
  const anchor = target.translateToOriginPoint(target.getCenterPoint(), originX, originY);
  const box = boxOf(target);
  const fixedAt = axis === 0 ? anchor.x : anchor.y;
  const movingHigh = Math.abs(fixedAt - low(box, axis)) < Math.abs(fixedAt - high(box, axis));

  const move = snapStretchedSide(box, axis, movingHigh, straightWalls(canvas), canvasPixels(FIXTURE_SNAP_SCREEN_PIXELS));
  if (!move) return;
  const extent = high(box, axis) - low(box, axis);
  const factor = (extent + (movingHigh ? move : -move)) / extent;
  if (ownWidth) target.set({ scaleX: (target.scaleX ?? 1) * factor });
  else target.set({ scaleY: (target.scaleY ?? 1) * factor });
  target.setPositionByOrigin(anchor, originX, originY);
  target.setCoords();
}

/**
 * While a fitting or piece of furniture is dragged: rests it against walls, and puts kitchen
 * appliances in line on the counter under them. Only for things square to the plan, against
 * walls that are too; anything at an angle moves freely.
 */
export function snapToWallsAndCounters(canvas: Canvas, target: FabricObject) {
  const stored = getStoredFloorplanObject(target);
  if (!stored || !["symbol", "furniture", "icon", "stair"].includes(stored.type) || !isSquareToCanvas(target)) {
    return;
  }
  const isAppliance =
    stored.type === "symbol" && stored.symbolId !== COUNTER_ID && getSymbolById(stored.symbolId)?.category === "kök";

  const walls = straightWalls(canvas);
  const counters: SnapBox[] = [];
  if (isAppliance) {
    canvas.forEachObject((object) => {
      const other = getStoredFloorplanObject(object);
      if (object !== target && object.visible && isSquareToCanvas(object) && other?.type === "symbol" && other.symbolId === COUNTER_ID) {
        counters.push(boxOf(object));
      }
    });
  }

  // How close, on screen, a box must come to a wall or a counter's edge to snap to it.
  const { dx, dy } = snapBoxToFixtures(boxOf(target), walls, counters, canvasPixels(FIXTURE_SNAP_SCREEN_PIXELS));
  if (dx || dy) {
    target.set({ left: (target.left ?? 0) + dx, top: (target.top ?? 0) + dy });
    target.setCoords();
  }
}

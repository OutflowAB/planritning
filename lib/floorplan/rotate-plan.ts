import { getSymbolById, uprightBox } from "@/lib/floorplan/symbol-library";
import type { FloorplanDocument, FloorplanObject } from "@/lib/floorplan/types";
import { SM_EDITOR } from "@/lib/sm-floorplan-layout";

type Point = [number, number];

// How much of the drawing area the turned plan fills, as on import.
const FILL = 0.9;

function turn([x, y]: Point, degrees: number): Point {
  const angle = (degrees * Math.PI) / 180;
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
}

const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];

/** Keeps an angle in [-180, 180). */
function normalise(degrees: number) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** A room label's rough box: the text is not measured here, only placed by its middle. */
function labelSize(object: Extract<FloorplanObject, { type: "roomLabel" }>): Point {
  return [object.text.length * object.fontSize * 0.65, object.fontSize];
}

/**
 * The size of an object's outline before its own rotation, for the ones placed by a corner and
 * turned about it. Turning these about their middle instead keeps their footprint when their
 * rotation is changed (an abbreviation box held upright).
 */
function boxSize(object: FloorplanObject): Point | null {
  switch (object.type) {
    case "door":
      return [object.width + object.strokeWidth, object.width + object.strokeWidth];
    case "window":
    case "stair":
    case "symbol":
    case "furniture":
      return [object.width, object.height];
    case "icon":
      return [object.size, object.size];
    default:
      return null;
  }
}

/** The points that bound an object on the canvas, for fitting the plan to its area. */
function extent(object: FloorplanObject): Point[] {
  if (object.type === "wall") {
    // A wall's real line, not the stroke corner it is stored by — as the importer measures it.
    const half = object.strokeWidth / 2;
    return [
      [object.x + half, object.y + half],
      [object.x2 + half, object.y2 + half],
    ];
  }
  if (object.type === "dimension") {
    return [
      [object.x, object.y],
      [object.x2, object.y2],
    ];
  }
  const corner: Point = [object.x, object.y];
  if (object.type === "door") {
    // Its swing from the hinge and mirrored across the wall, as the importer measures it, so a
    // flipped door fits too.
    const half = object.strokeWidth / 2;
    const [near, far] = [half, object.width + half];
    return [
      [near, near],
      [far, near],
      [near, 2 * object.width + half],
      [far, 2 * object.width + half],
    ].map((offset) => add(corner, turn(offset as Point, object.rotation)));
  }
  const size = object.type === "roomLabel" ? labelSize(object) : (boxSize(object) ?? [0, 0]);
  return [
    [0, 0],
    [size[0], 0],
    [0, size[1]],
    [size[0], size[1]],
  ].map((offset) => add(corner, turn(offset as Point, object.rotation)));
}

/**
 * The plan turned a quarter turn clockwise and refitted to its drawing area: everything turns
 * about the plan's middle, then the whole plan is scaled to fill the area as an import would,
 * with the scale in metres updated to match. Room names stay level and appliance abbreviations
 * stay readable. Plans without a drawing area (AI-redrawn images) cannot turn.
 */
export function rotatePlanQuarterTurn(document: FloorplanDocument): FloorplanDocument {
  const area = document.drawingArea;
  if (!area || document.objects.length === 0) {
    return document;
  }

  // Fitted by its walls and door swings, as on import. Both turn rigidly with the plan, so four
  // turns come back to the start; level room names would not. A plan without walls is fitted by
  // everything on it.
  const frame = document.objects.filter((object) => object.type === "wall" || object.type === "door");
  const points = (frame.some((object) => object.type === "wall") ? frame : document.objects).flatMap(extent);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const middle: Point = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  // Turned, the plan's width and height swap.
  const turnedWidth = Math.max(Math.max(...ys) - Math.min(...ys), 1);
  const turnedHeight = Math.max(Math.max(...xs) - Math.min(...xs), 1);
  const k = Math.min((area.width * FILL) / turnedWidth, (area.height * FILL) / turnedHeight);
  const areaMiddle: Point = [area.x + area.width / 2, area.y + area.height / 2];
  const place = (point: Point): Point => {
    const [x, y] = turn([point[0] - middle[0], point[1] - middle[1]], 90);
    return [areaMiddle[0] + x * k, areaMiddle[1] + y * k];
  };

  const objects = document.objects.map((object): FloorplanObject => {
    switch (object.type) {
      case "wall": {
        // Stored by the corner of the stroke: turn the real ends, then step back half the new stroke.
        const half = object.strokeWidth / 2;
        const strokeWidth = Math.max(SM_EDITOR.wallStroke, object.strokeWidth * k);
        const newHalf = strokeWidth / 2;
        const [x, y] = place([object.x + half, object.y + half]);
        const [x2, y2] = place([object.x2 + half, object.y2 + half]);
        return { ...object, x: x - newHalf, y: y - newHalf, x2: x2 - newHalf, y2: y2 - newHalf, strokeWidth };
      }

      case "roomLabel": {
        const [width, height] = labelSize(object);
        const [cx, cy] = place([object.x + width / 2, object.y + height / 2]);
        return { ...object, x: cx - width / 2, y: cy - height / 2 };
      }

      case "dimension": {
        // A rigid group placed by its first end: turn that end, keep the other end's offset scaled.
        const [x, y] = place([object.x, object.y]);
        return {
          ...object,
          x,
          y,
          x2: x + (object.x2 - object.x) * k,
          y2: y + (object.y2 - object.y) * k,
          rotation: normalise(object.rotation + 90),
        };
      }

      case "eraserStroke": {
        const [x, y] = place([object.x, object.y]);
        return { ...object, x, y, rotation: normalise(object.rotation + 90), scaleX: object.scaleX * k, scaleY: object.scaleY * k };
      }

      default: {
        const size = boxSize(object);
        if (!size) return object;
        const middleOfBox = place(add([object.x, object.y], turn([size[0] / 2, size[1] / 2], object.rotation)));
        let scaled = scaleSizes(object, k);
        let rotation = normalise(object.rotation + 90);
        if (scaled.type === "symbol" && getSymbolById(scaled.symbolId)?.text) {
          // Abbreviation boxes swap sides instead of turning, so their letters stay level.
          const upright = uprightBox(scaled.width, scaled.height, rotation);
          scaled = { ...scaled, width: upright.width, height: upright.height };
          rotation = upright.rotation;
        }
        const newSize = boxSize(scaled)!;
        const [x, y] = add(middleOfBox, turn([-newSize[0] / 2, -newSize[1] / 2], rotation));
        return { ...scaled, x, y, rotation };
      }
    }
  });

  return {
    ...document,
    objects,
    ...(document.scale ? { scale: { pxPerMeter: document.scale.pxPerMeter * k } } : {}),
  };
}

/** The object with its real-world sizes scaled; line weights and text sizes stay as they are. */
function scaleSizes(object: FloorplanObject, k: number): FloorplanObject {
  switch (object.type) {
    case "door":
      return { ...object, width: object.width * k };
    case "symbol":
      return {
        ...object,
        width: object.width * k,
        height: object.height * k,
        ...(object.textSize ? { textSize: object.textSize * k } : {}),
      };
    case "window":
    case "stair":
    case "furniture":
      return { ...object, width: object.width * k, height: object.height * k };
    case "icon":
      return { ...object, size: object.size * k };
    default:
      return object;
  }
}

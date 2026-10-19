import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { BLANK_DRAWING_HEIGHT, createBlankFloorplanImage } from "@/lib/image/blank-floorplan";
import { polygonArea } from "@/lib/floorplan/measure";
import {
  alignToWalls,
  cleanUpWalls,
  fillWallsFromFloor,
  meshWindowSpans,
  parseScanPlan,
  RAW_ROOMPLAN_MESSAGE,
  scanToFloorplanDocument,
  type DrawingSlot,
  type ScanPlan,
} from "@/lib/floorplan/scan-import";
import type { FloorplanDocument, WallObject } from "@/lib/floorplan/types";

const FIXTURES = path.resolve(__dirname, "fixtures/scans");
const META = {
  imageId: 1,
  imagePath: "generated/blank-test.png",
  fileName: "bild-1",
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};

function fixture(name: string): ScanPlan {
  const parsed = parseScanPlan(JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.scan;
}

/** Walls by their centre line; the stored coordinates are the corner of the stroke. */
function walls(document: FloorplanDocument) {
  return document.objects
    .filter((object): object is WallObject => object.type === "wall")
    .map((wall) => {
      const half = wall.strokeWidth / 2;
      return { ...wall, x: wall.x + half, y: wall.y + half, x2: wall.x2 + half, y2: wall.y2 + half };
    });
}

function count(document: FloorplanDocument, type: string) {
  return document.objects.filter((object) => object.type === type).length;
}

let slot: DrawingSlot;

beforeAll(async () => {
  slot = await createBlankFloorplanImage();
});

describe("parseScanPlan", () => {
  it.each(["rectangle", "l-shape", "two-rooms"])("accepts the %s test room", (name) => {
    expect(() => fixture(name)).not.toThrow();
  });

  const valid = { version: 1, walls: [{ start: [0, 0], end: [4, 0] }] };

  it.each([
    ["not an object", null],
    ["an unknown version", { ...valid, version: 2 }],
    ["no walls", { ...valid, walls: [] }],
    ["a wall without length", { version: 1, walls: [{ start: [1, 1], end: [1, 1] }] }],
    ["a non-numeric point", { version: 1, walls: [{ start: [0, "x"], end: [4, 0] }] }],
    ["a door on a missing wall", { ...valid, doors: [{ wall: 3, offset: 0, width: 1 }] }],
    ["a window past the wall end", { ...valid, windows: [{ wall: 0, offset: 3.5, width: 1 }] }],
    ["a room without a name", { ...valid, rooms: [{ name: " ", center: [1, 1] }] }],
    ["a room outline of two points", { ...valid, rooms: [{ name: "A", center: [1, 1], outline: [[0, 0], [1, 1]] }] }],
    ["an object without a size", { ...valid, objects: [{ category: "toilet", center: [1, 1], width: 0, depth: 1 }] }],
    ["an object without a category", { ...valid, objects: [{ center: [1, 1], width: 1, depth: 1 }] }],
  ])("rejects %s", (_label, input) => {
    expect(parseScanPlan(input).ok).toBe(false);
  });
});

describe("scanToFloorplanDocument", () => {
  it("fits the plan in the drawing slot and keeps the scale", () => {
    const document = scanToFloorplanDocument(fixture("rectangle"), slot, META);

    // 5 x 4 m in the 3:2 slot at 90 %: the height decides, with room for the 0.9 m door in the
    // top wall to swing out past it.
    const scale = document.scale!.pxPerMeter;
    expect(scale).toBeCloseTo((BLANK_DRAWING_HEIGHT * 0.9) / 4.9);
    expect(document.canvas).toEqual({ width: slot.canvasWidth, height: slot.canvasHeight });

    const xs = walls(document).flatMap((wall) => [wall.x, wall.x2]);
    const ys = walls(document).flatMap((wall) => [wall.y, wall.y2]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(slot.imageX);
    expect(Math.max(...xs)).toBeLessThanOrEqual(slot.imageX + slot.imageWidth);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(slot.imageY);
    expect(Math.max(...ys)).toBeLessThanOrEqual(slot.imageY + slot.imageHeight);
    // Centred in the slot.
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(slot.imageX + slot.imageWidth / 2);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(slot.imageY + slot.imageHeight / 2 + 0.45 * scale);
  });

  it("leaves the doors and windows open in the walls", () => {
    const document = scanToFloorplanDocument(fixture("rectangle"), slot, META);
    const scale = document.scale!.pxPerMeter;
    const drawn = walls(document).reduce((sum, wall) => sum + Math.hypot(wall.x2 - wall.x, wall.y2 - wall.y), 0);

    // 18 m of wall minus a 0.9 m door and 1.2 m + 1.5 m of windows.
    expect(drawn / scale).toBeCloseTo(18 - 0.9 - 1.2 - 1.5);
    expect(count(document, "door")).toBe(1);
    expect(count(document, "window")).toBe(2);
    expect(count(document, "roomLabel")).toBe(1);
  });

  it("draws every wall from its left end, as the editor expects", () => {
    for (const name of ["rectangle", "l-shape", "two-rooms"]) {
      for (const wall of walls(scanToFloorplanDocument(fixture(name), slot, META))) {
        expect(wall.x2 > wall.x || (wall.x2 === wall.x && wall.y2 >= wall.y)).toBe(true);
      }
    }
  });

  it("puts a door's hinge line on its wall", () => {
    const document = scanToFloorplanDocument(fixture("rectangle"), slot, META);
    const door = document.objects.find((object) => object.type === "door");
    const topWallY = Math.min(...walls(document).map((wall) => wall.y));
    // The top wall runs left to right, so the door is unrotated and its hinge line is the bottom
    // of its outline (whose corner sits half a stroke out).
    expect(door?.rotation).toBeCloseTo(0);
    expect(door && door.type === "door" ? door.y + door.width + door.strokeWidth / 2 : NaN).toBeCloseTo(topWallY);
  });

  it("splits an inner wall around its door", () => {
    const document = scanToFloorplanDocument(fixture("two-rooms"), slot, META);
    const scale = document.scale!.pxPerMeter;
    const middleX = slot.imageX + slot.imageWidth / 2;
    const innerWall = walls(document).filter(
      (wall) => Math.abs(wall.x - middleX) < 1 && Math.abs(wall.x2 - middleX) < 1,
    );

    expect(innerWall).toHaveLength(2);
    const drawn = innerWall.reduce((sum, wall) => sum + Math.abs(wall.y2 - wall.y), 0);
    expect(drawn / scale).toBeCloseTo(4 - 0.8);
    expect(count(document, "roomLabel")).toBe(2);
  });

  it("names rooms in capitals and keeps their floor area", () => {
    const labels = scanToFloorplanDocument(fixture("two-rooms"), slot, META).objects.filter(
      (object) => object.type === "roomLabel",
    );
    expect(labels.map((label) => [label.text, label.areaM2])).toEqual([
      ["KÖK", 16],
      ["SOVRUM", 16],
    ]);
  });

  it("draws fixed fittings and stairs, and leaves furniture out", () => {
    const kitchen = scanToFloorplanDocument(fixture("two-rooms"), slot, META);
    expect(
      kitchen.objects.flatMap((object) => (object.type === "symbol" ? [object.symbolId] : [])),
    ).toEqual(["spis", "diskho", "kyl"]);

    const lShape = scanToFloorplanDocument(fixture("l-shape"), slot, META);
    expect(count(lShape, "stair")).toBe(1);
    expect(count(lShape, "symbol") + count(lShape, "furniture")).toBe(0);
  });

  it("sizes fittings from the scan and centres them on its position", () => {
    const document = scanToFloorplanDocument(fixture("two-rooms"), slot, META);
    const scale = document.scale!.pxPerMeter;
    const stove = document.objects.find((object) => object.type === "symbol" && object.symbolId === "spis");
    if (stove?.type !== "symbol") throw new Error("no stove");

    expect(stove.width / scale).toBeCloseTo(0.6);
    // Unrotated, so its corner is half its size up and left of the scanned centre.
    const left = walls(document).reduce((min, wall) => Math.min(min, wall.x, wall.x2), Infinity);
    expect((stove.x + stove.width / 2 - left) / scale).toBeCloseTo(0.6);
  });

  it("turns a scan taken at an angle so its walls run straight", () => {
    // The rectangle as a phone held at 35° would report it, with a small measuring wobble.
    const turn = (35 * Math.PI) / 180;
    const rotate = ([x, y]: [number, number]): [number, number] => [
      x * Math.cos(turn) - y * Math.sin(turn),
      x * Math.sin(turn) + y * Math.cos(turn),
    ];
    const original = fixture("rectangle");
    const tilted: ScanPlan = {
      ...original,
      walls: original.walls.map((wall, index) => ({
        ...wall,
        start: rotate(wall.start),
        end: rotate([wall.end[0] + (index === 0 ? 0.02 : 0), wall.end[1]]),
      })),
      rooms: original.rooms?.map((room) => ({ ...room, center: rotate(room.center), outline: room.outline?.map(rotate) })),
      objects: [{ category: "toilet", center: rotate([1, 1]), width: 0.4, depth: 0.7, rotation: 35 }],
    };

    const aligned = alignToWalls(tilted);
    for (const wall of aligned.walls) {
      const straight = Math.abs(wall.start[0] - wall.end[0]) < 1e-9 || Math.abs(wall.start[1] - wall.end[1]) < 1e-9;
      expect(straight).toBe(true);
    }
    const lengths = aligned.walls.map((wall) => Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]));
    expect(lengths[0]).toBeCloseTo(5, 1);
    expect(lengths[1]).toBeCloseTo(4, 1);
    // The room keeps its area, and the toilet turns with the house.
    expect(polygonArea(aligned.rooms![0].outline!)).toBeCloseTo(20);
    const quarterTurn = (((aligned.objects![0].rotation! % 90) + 90) % 90);
    expect(Math.min(quarterTurn, 90 - quarterTurn)).toBeLessThan(1);
  });

  it("draws a bathroom sink as a washbasin and a kitchen sink as a sink", () => {
    const scan = parseScanPlan({
      version: 1,
      walls: [{ start: [0, 0], end: [6, 0] }, { start: [6, 0], end: [6, 3] }],
      rooms: [
        { name: "Badrum", center: [1, 1.5] },
        { name: "Kök", center: [5, 1.5] },
      ],
      objects: [
        { category: "sink", center: [1.2, 0.4], width: 0.5, depth: 0.45 },
        { category: "sink", center: [4.8, 0.4], width: 0.8, depth: 0.6 },
      ],
    });
    if (!scan.ok) throw new Error(scan.message);
    const symbols = scanToFloorplanDocument(scan.scan, slot, META).objects.flatMap((object) =>
      object.type === "symbol" ? [object.symbolId] : [],
    );
    expect(symbols).toEqual(["handfat", "diskho"]);
  });

  // Our symbols carry no abbreviation letters yet, so there is nothing to keep upright.
  it.skip("keeps an appliance's abbreviation upright however it was scanned", () => {
    const scan = parseScanPlan({
      version: 1,
      walls: [{ start: [0, 0], end: [4, 0] }, { start: [4, 0], end: [4, 3] }],
      objects: [{ category: "refrigerator", center: [1, 1], width: 0.6, depth: 0.6, rotation: 178 }],
    });
    if (!scan.ok) throw new Error(scan.message);
    const fridge = scanToFloorplanDocument(scan.scan, slot, META).objects.find((object) => object.type === "symbol");

    expect(Math.abs(fridge!.rotation)).toBeLessThanOrEqual(45);
  });

  it("puts wall pieces a few centimetres apart on one line and closes corners", () => {
    const cleaned = cleanUpWalls({
      version: 1,
      walls: [
        { start: [0, 0], end: [2, 0] },
        // The same outer wall on the other side of a door, measured 5 cm off.
        { start: [2.9, 0.05], end: [5, 0.05] },
        // Stops 7 cm short of the wall it meets.
        { start: [5.07, 0], end: [5.07, 3] },
      ],
    });

    expect(cleaned.walls[0].start[1]).toBeCloseTo(cleaned.walls[1].start[1]);
    expect(cleaned.walls[1].end[0]).toBeCloseTo(cleaned.walls[2].start[0]);
    expect(cleaned.walls[2].start[1]).toBeCloseTo(cleaned.walls[1].end[1]);
  });

  it("turns a small closed box of walls into a wardrobe and keeps doors on their walls", () => {
    const room = {
      version: 1 as const,
      walls: [
        { start: [0, 0], end: [4, 0] },
        { start: [4, 0], end: [4, 3] },
        { start: [4, 3], end: [0, 3] },
        // The wardrobe: a front 1.2 m wide and two sides 0.6 m deep, back against the bottom wall.
        { start: [1, 2.4], end: [2.2, 2.4] },
        { start: [1, 2.4], end: [1, 3] },
        { start: [2.2, 2.4], end: [2.2, 3] },
        { start: [0, 3], end: [0, 0] },
      ] as ScanPlan["walls"],
      doors: [{ wall: 6, offset: 1, width: 0.9 }],
    };

    const cleaned = cleanUpWalls(room);
    expect(cleaned.walls).toHaveLength(4);
    expect(cleaned.doors).toEqual([{ wall: 3, offset: 1, width: 0.9 }]);
    expect(cleaned.walls[3].start).toEqual([0, 3]);
    const [wardrobe] = cleaned.objects ?? [];
    expect(cleaned.objects).toHaveLength(1);
    expect(wardrobe.category).toBe("wardrobe");
    expect(wardrobe.center[0]).toBeCloseTo(1.6);
    expect(wardrobe.width).toBeCloseTo(1.2);
    // From the front to the face of the 15 cm back wall, not into it.
    expect(wardrobe.depth).toBeCloseTo(0.525);
    expect(wardrobe.center[1] + wardrobe.depth / 2).toBeCloseTo(3 - 0.075);

    const symbols = scanToFloorplanDocument(room, slot, META).objects.flatMap((object) =>
      object.type === "symbol" ? [object.symbolId] : [],
    );
    expect(symbols).toEqual(["garderob"]);
  });

  it("leaves boxes with a door, and recesses too narrow for a wardrobe, as walls", () => {
    const box = (frontWidth: number) => [
      { start: [0, 0], end: [4, 0] },
      { start: [1, 0.6], end: [1 + frontWidth, 0.6] },
      { start: [1, 0.6], end: [1, 0] },
      { start: [1 + frontWidth, 0.6], end: [1 + frontWidth, 0] },
    ] as ScanPlan["walls"];

    expect(cleanUpWalls({ version: 1, walls: box(0.45) }).walls).toHaveLength(4);
    expect(cleanUpWalls({ version: 1, walls: box(1.2), doors: [{ wall: 1, offset: 0.2, width: 0.8 }] }).walls).toHaveLength(4);
  });

  it("closes the wall behind a wardrobe box that stands out from a gap between two walls", () => {
    // The outer wall stops either side of the box instead of running behind it.
    const cleaned = cleanUpWalls({
      version: 1,
      walls: [
        { start: [0, 3], end: [1, 3] },
        { start: [1, 3], end: [1, 2.4] },
        { start: [1, 2.4], end: [2.2, 2.4] },
        { start: [2.2, 2.4], end: [2.2, 3] },
        { start: [2.2, 3], end: [4, 3] },
      ],
    });

    expect(cleaned.objects?.map((object) => object.category)).toEqual(["wardrobe"]);
    // Along y = 3, the walls now cover 0 to 4 m with no hole.
    const covered = cleaned.walls
      .filter((wall) => Math.abs(wall.start[1] - 3) < 0.01 && Math.abs(wall.end[1] - 3) < 0.01)
      .reduce((sum, wall) => sum + Math.abs(wall.end[0] - wall.start[0]), 0);
    expect(covered).toBeCloseTo(4);
  });

  const importScan = (input: unknown) => {
    const scan = parseScanPlan(input);
    if (!scan.ok) throw new Error(scan.message);
    return scanToFloorplanDocument(scan.scan, slot, META);
  };
  const symbolsOf = (input: unknown) =>
    importScan(input).objects.flatMap((object) => (object.type === "symbol" ? [object] : []));

  it("draws storage as a worktop in the kitchen and a wardrobe elsewhere, but not in the bathroom", () => {
    const symbols = symbolsOf({
      version: 1,
      walls: [{ start: [0, 0], end: [12, 0] }, { start: [12, 0], end: [12, 3] }],
      rooms: [
        { name: "Kök", center: [1, 1.5] },
        { name: "Sovrum", center: [6, 1.5] },
        { name: "Badrum", center: [11, 1.5] },
      ],
      objects: [
        { category: "storage", center: [1, 0.4], width: 1.5, depth: 0.6 },
        { category: "storage", center: [6, 0.4], width: 1.5, depth: 0.6 },
        { category: "storage", center: [11, 0.4], width: 0.6, depth: 0.3 },
      ],
    });
    expect(symbols.map((symbol) => symbol.symbolId)).toEqual(["bankskiva", "garderob"]);
  });

  it("joins kitchen cabinets along one wall into one worktop and keeps an L-shaped kitchen two", () => {
    const document = importScan({
      version: 1,
      walls: [{ start: [0, 0], end: [4, 0] }, { start: [0, 0], end: [0, 3] }],
      rooms: [{ name: "Kök", center: [2, 1.5] }],
      objects: [
        // Along the top wall: three cabinets found one by one, overlapping and a few cm apart.
        { category: "storage", center: [1, 0.3], width: 0.8, depth: 0.6 },
        { category: "storage", center: [1.8, 0.25], width: 1, depth: 0.5 },
        { category: "storage", center: [2.65, 0.3], width: 0.6, depth: 0.6 },
        // Down the left wall, facing the other way.
        { category: "storage", center: [0.3, 1.5], width: 1.2, depth: 0.6, rotation: 90 },
      ],
    });

    const counters = document.objects.flatMap((object) =>
      object.type === "symbol" && object.symbolId === "bankskiva" ? [object] : [],
    );
    expect(counters).toHaveLength(2);
    const scale = document.scale!.pxPerMeter;
    const lengths = counters.map((counter) => Math.max(counter.width, counter.height) / scale).sort();
    // 0.6 to 2.95 m along the top; 0.9 to 2.1 m down the side.
    expect(lengths[0]).toBeCloseTo(1.2);
    expect(lengths[1]).toBeCloseTo(2.35);
  });

  it("draws a cooker as its hob, not the oven RoomPlan also finds under it", () => {
    const symbols = symbolsOf({
      version: 1,
      walls: [{ start: [0, 0], end: [4, 0] }],
      rooms: [{ name: "Kök", center: [2, 1.5] }],
      objects: [
        { category: "stove", center: [1, 0.3], width: 0.6, depth: 0.6 },
        { category: "oven", center: [1, 0.3], width: 0.6, depth: 0.6 },
        // A wall oven elsewhere is still an oven.
        { category: "oven", center: [3, 0.3], width: 0.6, depth: 0.6 },
      ],
    });
    expect(symbols.map((symbol) => symbol.symbolId)).toEqual(["spis", "ugn"]);
  });

  describe("on other kinds of property", () => {
    it("does not chain a stepped facade into one line", () => {
      // A villa facade stepping out 8 cm three times: each step is within merging distance of
      // the next, but the whole facade spans 24 cm and must keep its steps.
      const facade = [0, 0.08, 0.16, 0.24].map((y, index) => ({
        start: [index * 3, y] as [number, number],
        end: [index * 3 + 2.5, y] as [number, number],
      }));
      const ys = cleanUpWalls({ version: 1, walls: facade }).walls.map((wall) => wall.start[1]);

      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.1);
    });

    it("leaves a shallow pipe shaft as walls", () => {
      const shaft = [
        { start: [0, 0], end: [4, 0] },
        { start: [1, 0.3], end: [1.8, 0.3] },
        { start: [1, 0.3], end: [1, 0] },
        { start: [1.8, 0.3], end: [1.8, 0] },
      ] as ScanPlan["walls"];

      expect(cleanUpWalls({ version: 1, walls: shaft }).walls).toHaveLength(4);
    });

    it("finds a sink's room by outline in a large home, not by the nearest centre", () => {
      // A long open-plan kitchen whose centre is far from its sink; the bathroom's centre is nearer.
      const scan = parseScanPlan({
        version: 1,
        walls: [{ start: [0, 0], end: [12, 0] }, { start: [12, 0], end: [12, 6] }],
        rooms: [
          { name: "Kök", center: [3, 3], outline: [[0, 0], [8, 0], [8, 6], [0, 6]] },
          { name: "Badrum", center: [10, 1.5], outline: [[8, 0], [12, 0], [12, 3], [8, 3]] },
        ],
        objects: [{ category: "sink", center: [7.6, 0.4], width: 0.8, depth: 0.6 }],
      });
      if (!scan.ok) throw new Error(scan.message);
      const symbols = scanToFloorplanDocument(scan.scan, slot, META).objects.flatMap((object) =>
        object.type === "symbol" ? [object.symbolId] : [],
      );

      expect(symbols).toEqual(["diskho"]);
    });

    it("keeps a 45° wing diagonal while straightening the rest of the house", () => {
      const aligned = alignToWalls({
        version: 1,
        walls: [
          { start: [0, 0], end: [8, 0] },
          { start: [8, 0], end: [8, 4] },
          { start: [8, 4], end: [10, 6] },
          { start: [0, 0], end: [0, 6] },
        ],
      });
      const [, , wing] = aligned.walls;

      expect(Math.abs(wing.end[0] - wing.start[0])).toBeCloseTo(Math.abs(wing.end[1] - wing.start[1]));
      expect(aligned.walls[0].start[1]).toBeCloseTo(aligned.walls[0].end[1]);
    });
  });

  it("leaves a passage open without drawing anything in it", () => {
    const scan = parseScanPlan({
      version: 1,
      walls: [{ start: [0, 0], end: [4, 0] }],
      openings: [{ wall: 0, offset: 1, width: 1.2 }],
    });
    if (!scan.ok) throw new Error(scan.message);
    const document = scanToFloorplanDocument(scan.scan, slot, META);
    const drawn = walls(document).reduce((sum, wall) => sum + Math.hypot(wall.x2 - wall.x, wall.y2 - wall.y), 0);

    expect(walls(document)).toHaveLength(2);
    expect(drawn / document.scale!.pxPerMeter).toBeCloseTo(4 - 1.2);
    expect(count(document, "door") + count(document, "window")).toBe(0);
  });

  it("ties each wall's pieces and openings together, and nothing else", () => {
    const document = scanToFloorplanDocument(fixture("rectangle"), slot, META);
    const groups = new Map<string, string[]>();
    for (const object of document.objects) {
      if ("wallId" in object && object.wallId) {
        groups.set(object.wallId, [...(groups.get(object.wallId) ?? []), object.type]);
      }
    }

    // Four walls; the top one is split by its door, the two with windows by those.
    expect(groups.size).toBe(4);
    expect([...groups.values()].map((types) => types.sort().join(",")).sort()).toEqual([
      "door,wall,wall",
      "wall",
      "wall,wall,window",
      "wall,wall,window",
    ]);
    expect(document.objects.filter((object) => object.type === "roomLabel").every((label) => !("wallId" in label))).toBe(true);
  });

  it("scales a larger plan down to fit", () => {
    // 6 x 6 m: the height decides again, now over 6 m and the 1 m door swinging past an outer wall.
    expect(scanToFloorplanDocument(fixture("l-shape"), slot, META).scale?.pxPerMeter).toBeCloseTo(
      (BLANK_DRAWING_HEIGHT * 0.9) / 7,
    );
  });
});

describe("picking the wrong scan file", () => {
  it("explains that RoomPlan's own export is not the plan file", () => {
    const raw = {
      version: 2,
      coreModel: "…",
      walls: [{ identifier: "A", transform: [1, 0, 0, 0], dimensions: [3, 2.5, 0], category: { wall: {} } }],
    };
    expect(parseScanPlan(raw)).toEqual({ ok: false, message: RAW_ROOMPLAN_MESSAGE });
    expect(parseScanPlan({ walls: [{ transform: [], dimensions: [] }] })).toEqual({ ok: false, message: RAW_ROOMPLAN_MESSAGE });
  });
});

describe("fillWallsFromFloor", () => {
  // A 6 × 4 m room whose right wall is a glass front the scanner did not find.
  const floor: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
  const threeWalls: ScanPlan = {
    version: 1,
    walls: [
      { start: [0, 0], end: [6, 0] },
      { start: [6, 4], end: [0, 4] },
      { start: [0, 4], end: [0, 0] },
    ],
    windows: [{ wall: 0, offset: 1, width: 1.2 }],
    floor,
  };

  it("puts back a wall missing along the floor edge, and leaves the others alone", () => {
    const filled = fillWallsFromFloor(threeWalls);
    expect(filled.walls).toHaveLength(4);
    expect(filled.walls[3]).toEqual({ start: [6, 0], end: [6, 4] });
    // The window still points at the wall it was in.
    expect(filled.windows).toEqual(threeWalls.windows);
  });

  it("fills only the stretch that is missing when part of the wall was found", () => {
    // RoomPlan found the first metre and a half of the glass front (a frame), slightly off the edge.
    const partly = { ...threeWalls, walls: [...threeWalls.walls, { start: [6.1, 0], end: [6.1, 1.5] } as const] };
    const filled = fillWallsFromFloor(partly as ScanPlan);
    expect(filled.walls).toHaveLength(5);
    expect(filled.walls[4].start[1]).toBeCloseTo(1.5);
    expect(filled.walls[4].end[1]).toBeCloseTo(4);
  });

  it("ignores gaps too short to be a missing wall, such as at a corner", () => {
    const nearlyClosed = { ...threeWalls, walls: [...threeWalls.walls, { start: [6, 0.3], end: [6, 3.8] } as const] };
    expect(fillWallsFromFloor(nearlyClosed as ScanPlan).walls).toHaveLength(4);
  });

  it("uses a single room's outline when the scan has no floor, and does nothing without either", () => {
    const { floor: _floor, ...withoutFloor } = threeWalls;
    void _floor;
    const oneRoom = { ...withoutFloor, rooms: [{ name: "Rum", center: [3, 2], outline: floor }] } as ScanPlan;
    expect(fillWallsFromFloor(oneRoom).walls).toHaveLength(4);
    expect(fillWallsFromFloor(withoutFloor as ScanPlan).walls).toHaveLength(3);
  });

  it("is used when a scan becomes a plan", () => {
    const document = scanToFloorplanDocument(threeWalls, { canvasWidth: 1000, canvasHeight: 800, imageX: 0, imageY: 0, imageWidth: 1000, imageHeight: 800 }, META);
    const walls = document.objects.filter((object): object is WallObject => object.type === "wall");
    const rightmost = Math.max(...walls.flatMap((wall) => [wall.x, wall.x2]));
    // A wall stands along the right edge, where there was none in the scan.
    expect(walls.some((wall) => Math.abs(wall.x - rightmost) < 1 && Math.abs(wall.x2 - rightmost) < 1)).toBe(true);
  });

  it("accepts a valid floor outline and refuses a broken one", () => {
    expect(parseScanPlan({ ...threeWalls }).ok).toBe(true);
    expect(parseScanPlan({ ...threeWalls, floor: [[0, 0], [1, 1]] }).ok).toBe(false);
    expect(parseScanPlan({ ...threeWalls, floor: [[0, 0], [1, "x"], [2, 2]] }).ok).toBe(false);
  });
});

describe("meshWindowSpans", () => {
  // A 6 × 4 m room. Its right wall is glass (no window from RoomPlan); the mesh saw window there.
  const room: ScanPlan = {
    version: 1,
    walls: [
      { start: [0, 0], end: [6, 0] },
      { start: [6, 0], end: [6, 4] },
      { start: [6, 4], end: [0, 4] },
      { start: [0, 4], end: [0, 0] },
    ],
    windows: [{ wall: 0, offset: 1, width: 1.5 }],
  };
  // Points every 2 cm along a stretch of wall, a little off its line, as the mesh gives them.
  const along = (x0: number, y0: number, x1: number, y1: number, off: [number, number] = [0, 0]) => {
    const steps = Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.02);
    return Array.from({ length: steps }, (_, i): [number, number] => [x0 + ((x1 - x0) * i) / steps + off[0], y0 + ((y1 - y0) * i) / steps + off[1]]);
  };

  it("finds window seen along a wall, with a wide break kept as a break", () => {
    const meshWindows = [...along(6, 0.2, 6, 1.8, [0.05, 0]), ...along(6, 2.5, 6, 3.8, [-0.05, 0])];
    const right = meshWindowSpans({ ...room, meshWindows }).filter((span) => span.wall === 1);
    expect(right).toHaveLength(2);
    expect(right[0].from).toBeCloseTo(0.2, 1);
    expect(right[0].to).toBeCloseTo(1.8, 1);
    expect(right[1].from).toBeCloseTo(2.5, 1);
  });

  it("joins a gap as narrow as a window frame, and drops a stretch that is too short", () => {
    const meshWindows = [...along(6, 0.2, 6, 1.8), ...along(6, 2.0, 6, 3.8), ...along(0.7, 0, 1, 0)];
    const spans = meshWindowSpans({ ...room, meshWindows });
    expect(spans.filter((span) => span.wall === 1)).toHaveLength(1);
    expect(spans.filter((span) => span.wall === 0)).toHaveLength(0);
  });

  it("ignores what was seen through the glass, far beyond the wall, and a television's screen", () => {
    const beyond = along(9, 0.5, 9, 3.5); // a building across the street
    const tv = along(2, 4, 4, 4); // a screen on the bottom wall
    const withTv = { ...room, objects: [{ category: "television", center: [3, 3.9] as [number, number], width: 2, depth: 0.1 }] };
    expect(meshWindowSpans({ ...withTv, meshWindows: [...beyond, ...tv] })).toEqual([]);
  });

  it("is only a guide: the plan keeps RoomPlan's windows and gets lines for the mesh's", () => {
    const slot = { canvasWidth: 1000, canvasHeight: 800, imageX: 0, imageY: 0, imageWidth: 1000, imageHeight: 800 };
    const withMesh = scanToFloorplanDocument({ ...room, meshWindows: along(6, 0.5, 6, 3.5) }, slot, META);
    const without = scanToFloorplanDocument(room, slot, META);
    expect(withMesh.objects.filter((object) => object.type === "window")).toHaveLength(1);
    // The same objects either way (ids are random, so compare by kind).
    expect(withMesh.objects.map((object) => object.type)).toEqual(without.objects.map((object) => object.type));
    expect(withMesh.guides?.meshWindows).toHaveLength(1);
    expect(without.guides).toBeUndefined();
  });

  it("accepts mesh points and refuses broken ones", () => {
    expect(parseScanPlan({ ...room, meshWindows: [[1, 2]] }).ok).toBe(true);
    expect(parseScanPlan({ ...room, meshWindows: [[1, "x"]] }).ok).toBe(false);
  });
});

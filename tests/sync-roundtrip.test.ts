// @vitest-environment jsdom
// Room names and appliance letters are text, which Fabric measures with a DOM canvas.
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { attachExtendedData, createFabricObjectFromFloorplan, floorplanObjectFromFabric } from "@/lib/floorplan/fabric/sync";
import { parseScanPlan, scanToFloorplanDocument } from "@/lib/floorplan/scan-import";
import type { FloorplanDocument, FloorplanObject } from "@/lib/floorplan/types";
import { createBlankFloorplanImage } from "@/lib/image/blank-floorplan";

let plan: FloorplanDocument;

beforeAll(async () => {
  const slot = await createBlankFloorplanImage();
  const parsed = parseScanPlan(JSON.parse(readFileSync(path.resolve(__dirname, "fixtures/scans/two-rooms.json"), "utf8")));
  if (!parsed.ok) throw new Error(parsed.message);
  plan = scanToFloorplanDocument(parsed.scan, slot, {
    imageId: 1,
    imagePath: "generated/blank-test.png",
    fileName: "bild-1",
    createdAt: "2026-10-17T00:00:00.000Z",
    updatedAt: "2026-10-17T00:00:00.000Z",
  });
});

/** What an object looks like after being drawn on the canvas and read back, as a save does. */
function roundTrip(object: FloorplanObject) {
  const fabricObject = createFabricObjectFromFloorplan(object);
  attachExtendedData(fabricObject, object);
  return floorplanObjectFromFabric(fabricObject);
}

const GEOMETRY = ["x", "y", "x2", "y2", "width", "height", "rotation", "strokeWidth"] as const;

describe("saving a plan from the canvas", () => {
  it("reads every kind of object back where it was drawn", () => {
    const types = new Set<string>();
    for (const object of plan.objects) {
      const back = roundTrip(object);
      expect(back, object.type).not.toBeNull();
      types.add(object.type);
      for (const key of GEOMETRY) {
        const before = (object as Record<string, unknown>)[key];
        const after = (back as Record<string, unknown>)[key];
        if (typeof before === "number") expect(after, `${object.type}.${key}`).toBeCloseTo(before, 6);
      }
      expect(back?.id).toBe(object.id);
    }
    // The scan fixture exercises walls, doors, windows, fittings and room names.
    expect([...types].sort()).toEqual(["door", "roomLabel", "symbol", "wall", "window"]);
  });

  it("keeps a diagonal wall's ends whichever way it was drawn", () => {
    const wall = { ...plan.objects.find((object) => object.type === "wall")!, x: 500, y: 400, x2: 100, y2: 900 } as FloorplanObject;
    const back = roundTrip(wall) as typeof wall & { x2: number; y2: number };
    expect([back.x, back.y, back.x2, back.y2].map((value) => Math.round(value))).toEqual([500, 400, 100, 900]);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { createBlankFloorplanImage } from "@/lib/image/blank-floorplan";
import { lineLengthInMeters } from "@/lib/floorplan/measure";
import { rotatePlanQuarterTurn } from "@/lib/floorplan/rotate-plan";
import { parseScanPlan, scanToFloorplanDocument, type DrawingSlot } from "@/lib/floorplan/scan-import";
import type { FloorplanDocument, WallObject } from "@/lib/floorplan/types";

const META = {
  imageId: 1,
  imagePath: "generated/blank-test.png",
  fileName: "bild-1",
  createdAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
};

let slot: DrawingSlot;
let plan: FloorplanDocument;

beforeAll(async () => {
  slot = await createBlankFloorplanImage();
  const raw = JSON.parse(readFileSync(path.resolve(__dirname, "fixtures/scans/two-rooms.json"), "utf8"));
  // A fridge, to check its K/F box stays readable.
  raw.objects.push({ category: "refrigerator", center: [7, 3.4], width: 0.6, depth: 0.6 });
  const parsed = parseScanPlan(raw);
  if (!parsed.ok) throw new Error(parsed.message);
  plan = scanToFloorplanDocument(parsed.scan, slot, META);
});

const walls = (document: FloorplanDocument) =>
  document.objects.filter((object): object is WallObject => object.type === "wall");

describe("rotatePlanQuarterTurn", () => {
  it("comes back to where it started after four quarter turns", () => {
    let turned = plan;
    for (let i = 0; i < 4; i += 1) turned = rotatePlanQuarterTurn(turned);

    expect(turned.scale!.pxPerMeter).toBeCloseTo(plan.scale!.pxPerMeter, 3);
    walls(turned).forEach((wall, index) => {
      const original = walls(plan)[index];
      expect(wall.x).toBeCloseTo(original.x, 3);
      expect(wall.y).toBeCloseTo(original.y, 3);
      expect(wall.x2).toBeCloseTo(original.x2, 3);
      expect(wall.y2).toBeCloseTo(original.y2, 3);
    });
  });

  it("keeps real lengths: walls measure the same in metres after turning", () => {
    const turned = rotatePlanQuarterTurn(plan);

    walls(turned).forEach((wall, index) => {
      const original = walls(plan)[index];
      expect(lineLengthInMeters(turned.scale!, wall)).toBeCloseTo(lineLengthInMeters(plan.scale!, original), 3);
    });
    // The 8 x 4 m plan stands on end, so it has to shrink to fit the landscape page.
    expect(turned.scale!.pxPerMeter).toBeLessThan(plan.scale!.pxPerMeter);
  });

  it("keeps the plan inside its drawing area, room names level and abbreviations readable", () => {
    const turned = rotatePlanQuarterTurn(plan);
    const area = turned.drawingArea!;

    for (const wall of walls(turned)) {
      for (const [x, y] of [[wall.x, wall.y], [wall.x2, wall.y2]]) {
        expect(x).toBeGreaterThanOrEqual(area.x - wall.strokeWidth);
        expect(x).toBeLessThanOrEqual(area.x + area.width);
        expect(y).toBeGreaterThanOrEqual(area.y - wall.strokeWidth);
        expect(y).toBeLessThanOrEqual(area.y + area.height);
      }
    }
    for (const label of turned.objects.filter((object) => object.type === "roomLabel")) {
      expect(label.rotation).toBe(0);
    }
    const fridge = turned.objects.find((object) => object.type === "symbol" && object.symbolId === "kyl");
    // Letters level: the box swaps sides rather than standing on end.
    expect(Math.abs(fridge!.rotation)).toBeLessThanOrEqual(45);
  });

  it("keeps a door swinging out of the plan on the page, after import and after turning", () => {
    // 6 x 4 m fills the landscape page edge to edge, so a swing past the outer wall shows up.
    const parsed = parseScanPlan({
      version: 1,
      walls: [
        { start: [0, 0], end: [6, 0] },
        { start: [6, 0], end: [6, 4] },
        { start: [6, 4], end: [0, 4] },
        { start: [0, 4], end: [0, 0] },
      ],
      doors: [{ wall: 0, offset: 2, width: 0.9 }],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const imported = scanToFloorplanDocument(parsed.scan, slot, META);

    for (const document of [imported, rotatePlanQuarterTurn(imported)]) {
      const area = document.drawingArea!;
      const door = document.objects.find((object) => object.type === "door")!;
      const reach = door.width + door.strokeWidth;
      // Its swing on this side and, flipped with "Byt sida", on the other.
      for (const [dx, dy] of [[0, 0], [reach, 0], [0, 2 * reach], [reach, 2 * reach]]) {
        const angle = (door.rotation * Math.PI) / 180;
        const x = door.x + dx * Math.cos(angle) - dy * Math.sin(angle);
        const y = door.y + dx * Math.sin(angle) + dy * Math.cos(angle);
        expect(x).toBeGreaterThanOrEqual(area.x - 1);
        expect(x).toBeLessThanOrEqual(area.x + area.width + 1);
        expect(y).toBeGreaterThanOrEqual(area.y - 1);
        expect(y).toBeLessThanOrEqual(area.y + area.height + 1);
      }
    }
  });

  it("leaves a plan without a drawing area alone", () => {
    const aiPlan = { ...plan, drawingArea: undefined };
    expect(rotatePlanQuarterTurn(aiPlan)).toBe(aiPlan);
  });
});

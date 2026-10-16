import { describe, expect, it } from "vitest";

import { flipDoorSide } from "@/lib/floorplan/door";
import type { DoorObject } from "@/lib/floorplan/types";

const door = (overrides: Partial<DoorObject> = {}): DoorObject => ({
  id: "d",
  type: "door",
  x: 100,
  y: 200,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  width: 80,
  swing: "right",
  strokeWidth: 2,
  ...overrides,
});

describe("flipDoorSide", () => {
  it("swings the leaf to the other side of the wall around the same hinge", () => {
    // Unrotated, right-swinging: hinge at (101, 281), opening to the right along y = 281.
    const flipped = flipDoorSide(door());

    expect(flipped.swing).toBe("left");
    expect(Math.abs(flipped.rotation)).toBe(180);
    // Turned half a turn, the outline's corner is now below and right of the hinge.
    expect(flipped.x).toBeCloseTo(101 + 81);
    expect(flipped.y).toBeCloseTo(281 + 81);
  });

  it("flipping twice gives back the same door, at any angle", () => {
    for (const rotation of [0, 37, 90, -120]) {
      for (const swing of ["left", "right"] as const) {
        const original = door({ rotation, swing });
        const twice = flipDoorSide({ ...original, ...flipDoorSide(original) });
        expect(twice.x).toBeCloseTo(original.x);
        expect(twice.y).toBeCloseTo(original.y);
        expect(twice.swing).toBe(original.swing);
        expect(((twice.rotation - rotation) % 360 + 360) % 360).toBeCloseTo(0);
      }
    }
  });
});

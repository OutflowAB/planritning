import { describe, expect, it } from "vitest";

import { snapWallPoint, wallCentreLine, wallFromClicks } from "@/lib/floorplan/wall-placement";

const existing = [wallCentreLine({ x: 95, y: 95, x2: 495, y2: 95, strokeWidth: 10 })]; // centre 100,100 → 500,100

describe("wall placement", () => {
  it("joins a click near a wall's end or line to the wall", () => {
    expect(snapWallPoint({ x: 506, y: 104 }, existing, 12)).toEqual({ x: 500, y: 100 });
    expect(snapWallPoint({ x: 300, y: 108 }, existing, 12)).toEqual({ x: 300, y: 100 });
    expect(snapWallPoint({ x: 300, y: 140 }, existing, 12)).toEqual({ x: 300, y: 140 });
  });

  it("stores the wall by its stroke corner and straightens it with Shift", () => {
    const wall = wallFromClicks({ x: 500, y: 103 }, { x: 507, y: 400 }, { strokeWidth: 10, walls: existing, reach: 12, straight: true });
    // Starts on the existing wall's end, runs straight down.
    expect(wall).toEqual({ x: 495, y: 95, x2: 495, y2: 395, strokeWidth: 10 });
  });

  it("leaves a free wall where it was drawn", () => {
    const wall = wallFromClicks({ x: 0, y: 0 }, { x: 300, y: 50 }, { strokeWidth: 10, walls: [], reach: 12, straight: false });
    expect(wall).toEqual({ x: -5, y: -5, x2: 295, y2: 45, strokeWidth: 10 });
  });
});

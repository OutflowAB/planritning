import { describe, expect, it } from "vitest";

import { snapBoxToFixtures, snapStretchedSide, type SnapBox } from "@/lib/floorplan/snap-box";

const box = (left: number, top: number, width: number, height: number): SnapBox => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

// A room 0–1000 by 0–600 with 20 px walls drawn inside the line: top, left and right walls.
const top = box(0, 0, 1000, 20);
const left = box(0, 0, 20, 600);
const right = box(980, 0, 20, 600);
const walls = [top, left, right];

describe("snapBoxToFixtures", () => {
  it("rests a box against the face of the wall beside it, from either side", () => {
    expect(snapBoxToFixtures(box(400, 28, 60, 60), walls, [], 12)).toEqual({ dx: 0, dy: -8 });
    // Past the right wall's inner face by 5: back out to touch it.
    expect(snapBoxToFixtures(box(925, 200, 60, 60), walls, [], 12)).toEqual({ dx: -5, dy: 0 });
    // Outside the building, against the outer face.
    expect(snapBoxToFixtures(box(400, -66, 60, 60), walls, [], 12)).toEqual({ dx: 0, dy: 6 });
  });

  it("fits into a corner and leaves things out of reach alone", () => {
    expect(snapBoxToFixtures(box(30, 25, 60, 60), walls, [], 12)).toEqual({ dx: -10, dy: -5 });
    expect(snapBoxToFixtures(box(400, 300, 60, 60), walls, [], 12)).toEqual({ dx: 0, dy: 0 });
  });

  it("puts an appliance in line on the counter under it and flush with its ends", () => {
    // A counter along the top wall, 60 deep, from 300 to 700.
    const counter = box(300, 20, 400, 60);
    // A hob dropped 15 px forward on it: back to the counter's back, against the wall.
    expect(snapBoxToFixtures(box(450, 35, 58, 58), walls, [counter], 12)).toEqual({ dx: 0, dy: -15 });
    // A hob deeper than the counter still stands at the wall and sticks out at the front.
    expect(snapBoxToFixtures(box(450, 30, 63, 63), walls, [counter], 12)).toEqual({ dx: 0, dy: -10 });
    // Near the counter's end: flush with it.
    expect(snapBoxToFixtures(box(645, 25, 58, 58), walls, [counter], 12)).toEqual({ dx: -3, dy: -5 });
    // A counter standing free in the room (an island) has no back: the nearer edge wins.
    const island = box(300, 300, 400, 60);
    expect(snapBoxToFixtures(box(450, 305, 58, 58), walls, [island], 12)).toEqual({ dx: 0, dy: -3 });
  });

  it("handles a counter running down a wall", () => {
    const counter = box(20, 100, 60, 300);
    expect(snapBoxToFixtures(box(40, 200, 58, 58), walls, [counter], 12)).toEqual({ dx: -20, dy: 0 });
  });

  it("stops a counter being stretched at the face of the wall it reaches for", () => {
    // A counter along the top wall, its right end pulled to 4 px short of the right wall.
    const counter = box(300, 20, 676, 60);
    expect(snapStretchedSide(counter, 0, true, walls, 12)).toBe(4);
    // Its left end pulled toward the left wall, 9 px short.
    expect(snapStretchedSide(box(29, 20, 400, 60), 0, false, walls, 12)).toBe(-9);
    // Stretched down, away from any wall: no snap.
    expect(snapStretchedSide(counter, 1, true, walls, 12)).toBeNull();
  });
});

import { Line, type Transform } from "fabric";
import { describe, expect, it } from "vitest";

import { createWallControls } from "@/lib/floorplan/fabric/canva-controls";

/** A wall as the editor draws it: placed by its bounding box, ends given on the canvas. */
function wall(x1: number, y1: number, x2: number, y2: number, strokeWidth = 20) {
  return new Line([x1, y1, x2, y2], {
    left: Math.min(x1, x2) - strokeWidth / 2,
    top: Math.min(y1, y2) - strokeWidth / 2,
    originX: "left",
    originY: "top",
    strokeWidth,
    strokeLineCap: "square",
  });
}

/** Where the wall's ends are on the canvas now. */
function ends(line: Line) {
  const matrix = line.calcTransformMatrix();
  const { x1, y1, x2, y2 } = line.calcLinePoints();
  const [a, b] = [
    [x1, y1],
    [x2, y2],
  ].map(([x, y]) => [x * matrix[0] + y * matrix[2] + matrix[4], x * matrix[1] + y * matrix[3] + matrix[5]]);
  return { a, b };
}

function drag(line: Line, handle: "start" | "end", x: number, y: number) {
  const control = createWallControls()[handle];
  control.actionHandler({} as MouseEvent, { target: line } as unknown as Transform, x, y);
}

describe("wall end handles", () => {
  it("lengthen and shorten a wall along its own line, holding the other end", () => {
    const line = wall(100, 200, 300, 200);

    // Pulled out and a little off the line: the wall grows but stays level. The pointer holds the
    // square cap, half the stroke past the end.
    drag(line, "end", 410, 230);
    expect(ends(line).a).toEqual([100, 200]);
    expect(ends(line).b[0]).toBeCloseTo(400);
    expect(ends(line).b[1]).toBeCloseTo(200);

    drag(line, "start", 160, 180);
    expect(ends(line).a[0]).toBeCloseTo(170);
    expect(ends(line).a[1]).toBeCloseTo(200);
    expect(ends(line).b[0]).toBeCloseTo(400);
  });

  it("keeps a slanted wall's angle and never lets it shrink away", () => {
    const line = wall(0, 0, 300, 400);

    drag(line, "end", 600 + 6, 800 + 8);
    expect(ends(line).b[0]).toBeCloseTo(600);
    expect(ends(line).b[1]).toBeCloseTo(800);

    // Dragged past the other end: the wall stops at its own thickness.
    drag(line, "end", -500, -500);
    const { a, b } = ends(line);
    expect(a).toEqual([0, 0]);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(20);
    expect(b[1] / b[0]).toBeCloseTo(4 / 3);
  });
});

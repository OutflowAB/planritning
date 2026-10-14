import { describe, expect, it } from "vitest";

import { COMPASS_GEOMETRY, compassLayout, compassNeedlePoints, compassSvg } from "@/lib/image/sheet-compass";

describe("compass geometry", () => {
  const layout = compassLayout(100);

  it("has an inner ring inside the outer one with the letters in the band between", () => {
    expect(layout.innerRadius).toBeCloseTo(61.7, 1);
    expect(layout.letterRadius).toBeGreaterThan(layout.innerRadius);
    expect(layout.letterRadius).toBeLessThan(layout.outerRadius);
    // A letter (cap height 0.26R, half either way) fits in the band.
    const half = (100 * COMPASS_GEOMETRY.letterSizeRatio) / 2;
    expect(layout.letterRadius - half).toBeGreaterThan(layout.innerRadius);
    expect(layout.letterRadius + half).toBeLessThan(layout.outerRadius);
  });

  it("keeps strokes thin and uniform", () => {
    expect(layout.stroke).toBeGreaterThanOrEqual(1.5);
    expect(compassLayout(1000).stroke).toBeCloseTo(15, 5);
  });

  it("draws the needle from north to a notched tail with wings on the inner ring", () => {
    const needle = compassNeedlePoints(layout.innerRadius);
    expect(needle.north.y).toBeLessThan(0);
    expect(needle.north.x).toBe(0);
    expect(Math.hypot(needle.west.x, needle.west.y)).toBeCloseTo(layout.innerRadius, 5);
    expect(needle.west.x).toBeCloseTo(-needle.east.x, 5);
    expect(needle.tail.y).toBeGreaterThan(0);
  });

  it("turns the whole badge, letters included, as one group", () => {
    const svg = compassSvg(500, 400, 100, 37);
    const open = svg.indexOf('<g transform="rotate(37 500 400)">');
    expect(open).toBeGreaterThanOrEqual(0);
    // Letters are paths, after the rings and inside the same rotated group.
    expect(svg.indexOf("<path", open)).toBeGreaterThan(svg.indexOf("<polygon", open));
    expect(svg.match(/<path/g)).toHaveLength(4);
    expect(svg.match(/<line/g)).toHaveLength(4);
    expect(svg.match(/<circle/g)).toHaveLength(2);
  });

  it("changes only the rotation between two directions", () => {
    const a = compassSvg(500, 400, 100, 0);
    const b = compassSvg(500, 400, 100, 90);
    expect(a.replace("rotate(0 ", "rotate(90 ")).toBe(b);
  });
});

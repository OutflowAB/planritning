import { describe, expect, it } from "vitest";

import { compassLetterTilt } from "@/lib/image/compass-geometry";
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

  it("turns rings, ticks and needle as one group", () => {
    const svg = compassSvg(500, 400, 100, 37);
    const open = svg.indexOf('<g transform="rotate(37 500 400)">');
    expect(open).toBeGreaterThanOrEqual(0);
    const group = svg.slice(open, svg.indexOf("</g>\n    </g>", open));
    expect(group.match(/<circle/g)).toHaveLength(2);
    expect(group.match(/<line/g)).toHaveLength(4);
    expect(group.match(/<polygon/g)).toHaveLength(2);
    expect(svg.match(/<path/g)).toHaveLength(4);
  });

  it("keeps every letter readable: tilted with the badge, never upside down", () => {
    for (const rotation of [0, 20, 89, 91, 160, 215, 270, 359]) {
      const tilt = compassLetterTilt(rotation);
      expect(tilt).toBeGreaterThan(-90);
      expect(tilt).toBeLessThanOrEqual(90);
      // Same tilt as the badge, or the badge's tilt flipped by a half turn.
      expect(((tilt - rotation) % 180 + 180) % 180).toBeCloseTo(0, 6);
    }
    expect(compassLetterTilt(160)).toBeCloseTo(-20, 6);
    expect(compassLetterTilt(215)).toBeCloseTo(35, 6);
  });

  it("moves the letters around the band with the rotation", () => {
    const at = (rotation: number) =>
      [...compassSvg(500, 400, 100, rotation).matchAll(/<g transform="rotate\(([-\d.]+) ([\d.]+) ([\d.]+)\)"><path/g)].map(
        (m) => ({ x: Number(m[2]), y: Number(m[3]) }),
      );
    const north = at(0)[0];
    expect(north.x).toBeCloseTo(500, 1);
    expect(north.y).toBeCloseTo(400 - layout.letterRadius, 1);
    const east = at(90)[0]; // north has turned to the right
    expect(east.x).toBeCloseTo(500 + layout.letterRadius, 1);
    expect(east.y).toBeCloseTo(400, 1);
  });
});

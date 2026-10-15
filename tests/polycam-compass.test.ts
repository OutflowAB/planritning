import { describe, expect, it } from "vitest";

import { compassRotationFromScan } from "@/lib/polycam/compass";
import { parseRoomplan } from "@/lib/polycam/parse-roomplan";
import sample from "./fixtures/polycam/sample-optimized-roomplan.json";
import multiStorey from "./fixtures/polycam/multi-storey-optimized-roomplan.json";

function rotation(degrees: number) {
  const a = (degrees * Math.PI) / 180;
  return { t00: Math.cos(a), t02: -Math.sin(a), t03: 0, t20: Math.sin(a), t22: Math.cos(a), t23: 0 };
}

describe("compassRotationFromScan", () => {
  it("has no direction without a heading", () => {
    expect(compassRotationFromScan(null, null)).toBeNull();
    expect(compassRotationFromScan(Number.NaN, null)).toBeNull();
  });

  it("points north straight up when the scan faces north", () => {
    expect(compassRotationFromScan(0, null)).toBeCloseTo(0, 6);
  });

  it("turns north counter-clockwise by the heading when there is no alignment", () => {
    // Facing east, north is to the left of the plan.
    expect(compassRotationFromScan(90, null)).toBeCloseTo(270, 6);
    expect(compassRotationFromScan(180, null)).toBeCloseTo(180, 6);
  });

  it("adds the alignment rotation", () => {
    expect(compassRotationFromScan(0, rotation(30))).toBeCloseTo(30, 6);
    expect(compassRotationFromScan(90, rotation(-9.49))).toBeCloseTo(270 - 9.49, 6);
  });

  it("stays within 0-360", () => {
    for (const heading of [-720, -1, 359.9, 1000]) {
      const value = compassRotationFromScan(heading, rotation(17)) as number;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(360);
    }
  });

  it.each([
    ["sample", sample, 299.14],
    ["multi-storey", multiStorey, 360 + 12.34 - 178.45],
  ])("derives a value from the %s scan", (_name, file, expected) => {
    const model = parseRoomplan(file);
    expect(compassRotationFromScan(model.orientationDegrees, model.alignment)).toBeCloseTo(
      expected,
      1,
    );
  });
});

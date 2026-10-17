import { describe, expect, it } from "vitest";

import {
  formatMeters,
  formatSquareMeters,
  lineLengthInMeters,
  polygonArea,
  totalRoomArea,
} from "@/lib/floorplan/measure";
import type { FloorplanDocument } from "@/lib/floorplan/types";

describe("measure", () => {
  it("formats with a Swedish decimal comma and one decimal", () => {
    expect(formatMeters(4.2)).toBe("4,2 m");
    expect(formatMeters(3)).toBe("3,0 m");
    expect(formatSquareMeters(12.46)).toBe("12,5 m²");
  });

  it("measures polygon areas in either winding order", () => {
    expect(polygonArea([[0, 0], [5, 0], [5, 4], [0, 4]])).toBe(20);
    expect(polygonArea([[0, 4], [5, 4], [5, 0], [0, 0]])).toBe(20);
    // L-shape: 6 x 6 m minus a 3 x 3 m corner.
    expect(polygonArea([[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]])).toBe(27);
  });

  it("converts a drawn line to metres with the plan's scale", () => {
    expect(lineLengthInMeters({ pxPerMeter: 100 }, { x: 10, y: 10, x2: 310, y2: 410 })).toBe(5);
  });

  it("totals the room areas a plan knows, and nothing when it knows none", () => {
    const base = { version: 1 as const, canvas: { width: 1, height: 1 }, meta: {} as FloorplanDocument["meta"] };
    const label = (areaM2?: number) => ({
      id: String(Math.random()),
      type: "roomLabel" as const,
      x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
      text: "RUM", fontSize: 18, fontFamily: "Arial", fill: "#000", textAlign: "center" as const,
      ...(areaM2 === undefined ? {} : { areaM2 }),
    });

    expect(totalRoomArea({ ...base, objects: [label()] })).toBeNull();
    expect(totalRoomArea({ ...base, objects: [label(16), label(), label(11.5)] })).toEqual({
      squareMeters: 27.5,
      rooms: 2,
    });
  });
});

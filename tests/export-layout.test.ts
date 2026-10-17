import { describe, expect, it } from "vitest";

import { fitToA4, LIBRARY_EXPORT_FORMATS, printableDocument } from "@/lib/floorplan/export-layout";
import type { FloorplanDocument } from "@/lib/floorplan/types";
import { houseAddressLine, houseTextLayout } from "@/lib/sm-floorplan-layout";

describe("exports", () => {
  it("offers PDF, PNG, JPG and SVG once each", () => {
    expect(LIBRARY_EXPORT_FORMATS.map((entry) => entry.format)).toEqual(["pdf", "png", "jpg", "svg"]);
  });

  it("fits a plan on A4 landscape inside 10 mm margins, centred", () => {
    // The 7:5 brand canvas is height-bound on A4 (277 × 190 mm of room).
    const page = fitToA4(3010, 2150);
    expect(page.height).toBeCloseTo(190);
    expect(page.width).toBeCloseTo(266);
    expect(page.x).toBeCloseTo((297 - page.width) / 2);
    expect(page.y).toBeCloseTo(10);
    // A very wide plan is width-bound instead.
    const wide = fitToA4(4000, 1000);
    expect(wide.width).toBeCloseTo(277);
    expect(wide.x).toBeCloseTo(10);
  });

  it("leaves measurement lines out of the delivered plan", () => {
    const document = {
      objects: [
        { id: "a", type: "wall" },
        { id: "b", type: "dimension" },
        { id: "c", type: "roomLabel" },
      ],
    } as unknown as FloorplanDocument;
    expect(printableDocument(document).objects.map((object) => object.id)).toEqual(["a", "c"]);
  });

  it("places the house text inside the frame on every plan size", () => {
    for (const [width, height] of [[3010, 2150], [2240, 1600], [1400, 1000]]) {
      const layout = houseTextLayout(width, height);
      const frameInset = width * 0.02;
      expect(layout.left).toBeGreaterThan(frameInset);
      expect(layout.right).toBeLessThan(width - frameInset);
      expect(layout.baseline).toBeLessThan(height - frameInset);
      expect(layout.baseline - layout.fontSize).toBeGreaterThan(height * 0.9);
    }
    expect(houseAddressLine("Storgatan 12", "entréplan")).toBe("STORGATAN 12 · ENTRÉPLAN");
    expect(houseAddressLine(null, null)).toBe("");
  });
});

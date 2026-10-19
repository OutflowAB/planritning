import { describe, expect, it } from "vitest";

import { houseAddressLine, houseTextLayout } from "@/lib/sm-floorplan-layout";

describe("the house text on a finished plan", () => {
  it("joins the address and floor in capitals, and prints nothing for an empty one", () => {
    expect(houseAddressLine(" Storgatan 1 ", "entréplan")).toBe("STORGATAN 1 · ENTRÉPLAN");
    expect(houseAddressLine("Storgatan 1", "")).toBe("STORGATAN 1");
    expect(houseAddressLine(null, undefined)).toBe("");
  });

  it("sits inside the frame on every plan size", () => {
    for (const [width, height] of [[3010, 2150], [2240, 1600], [1400, 1000]]) {
      const layout = houseTextLayout(width, height);
      const frameInset = width * 0.02;
      expect(layout.left).toBeGreaterThan(frameInset);
      expect(layout.right).toBeLessThan(width - frameInset);
      expect(layout.baseline).toBeLessThan(height - frameInset);
      expect(layout.baseline).toBeGreaterThan(height * 0.9);
    }
  });
});

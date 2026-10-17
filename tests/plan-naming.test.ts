import { describe, expect, it } from "vitest";

import { planDisplayName, planDownloadBaseName } from "@/lib/image-naming";
import { originalDocument } from "@/lib/floorplan/original-document";
import type { FloorplanDocument } from "@/lib/floorplan/types";

describe("plan names", () => {
  it("uses the address and floor once given, else the plan number", () => {
    expect(planDisplayName({ id: 12 })).toBe("Bild 12");
    expect(planDisplayName({ id: 12, address: "Storgatan 1", floor_label: "ENTRÉPLAN" })).toBe("Storgatan 1 · ENTRÉPLAN");
    expect(planDisplayName({ id: 12, address: "  ", floor_label: "PLAN 2" })).toBe("PLAN 2");
  });

  it("makes plain file names from Swedish addresses", () => {
    expect(planDownloadBaseName({ id: 12, address: "Östra Ågatan 5B", floor_label: "ÖVERVÅNING" })).toBe(
      "ostra-agatan-5b-overvaning",
    );
    expect(planDownloadBaseName({ id: 12 })).toBe("bild-12");
    expect(planDownloadBaseName({ id: 12, address: "///" })).toBe("bild-12");
  });
});

describe("originalDocument", () => {
  const current = {
    version: 1,
    canvas: { width: 100, height: 80 },
    meta: { imageId: 7, imagePath: "generated/blank-x.png", fileName: "bild-7", createdAt: "a", updatedAt: "b" },
    drawingArea: { x: 1, y: 2, width: 3, height: 4 },
    objects: [{ id: "edited" }],
  } as unknown as FloorplanDocument;

  it("returns to the imported scan when there is one", () => {
    const source = { ...current, objects: [{ id: "scanned-wall" }], meta: { ...current.meta, updatedAt: "old" } } as unknown as FloorplanDocument;
    const reset = originalDocument(current, source);
    expect(reset.objects).toEqual([{ id: "scanned-wall" }]);
    expect(reset.meta.imageId).toBe(7);
  });

  it("clears to an empty drawing on the same page otherwise", () => {
    const reset = originalDocument(current, null);
    expect(reset.objects).toEqual([]);
    expect(reset.drawingArea).toEqual(current.drawingArea);
  });
});

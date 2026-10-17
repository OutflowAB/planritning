import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { documentPreviewSvg, renderDocumentPreview } from "@/lib/floorplan/preview";
import { FLOORPLAN_DOCUMENT_VERSION, type FloorplanDocument, type FloorplanObject } from "@/lib/floorplan/types";

const base = { rotation: 0, scaleX: 1, scaleY: 1 };
const objects = [
  { ...base, id: "w", type: "wall", x: 100, y: 100, x2: 400, y2: 100, strokeWidth: 20 },
  { ...base, id: "win", type: "window", x: 200, y: 90, width: 80, height: 20, strokeWidth: 2 },
  { ...base, id: "d", type: "door", x: 300, y: 40, width: 90, swing: "right", strokeWidth: 2 },
  { ...base, id: "s", type: "symbol", symbolId: "wc", x: 120, y: 120, width: 40, height: 60, fill: "#fff", stroke: "#000" },
  { ...base, id: "hidden", type: "wall", x: 0, y: 0, x2: 50, y2: 0, strokeWidth: 20, visible: false },
] as FloorplanObject[];
const document: FloorplanDocument = {
  version: FLOORPLAN_DOCUMENT_VERSION,
  canvas: { width: 500, height: 300 },
  meta: { imageId: 1, imagePath: "generated/x.png", fileName: "x", createdAt: "", updatedAt: "" },
  drawingArea: { x: 0, y: 0, width: 500, height: 300 },
  objects,
};

describe("documentPreviewSvg", () => {
  it("draws walls, windows, door swings and boxes, and skips hidden objects", () => {
    const svg = documentPreviewSvg(document);
    expect(svg).toContain('width="500" height="300"');
    expect(svg).toContain('<line x1="100" y1="100" x2="400" y2="100" stroke="#000000" stroke-width="20"/>');
    expect(svg).toContain("A90 90 0 0 1"); // a right-swinging door sweeps clockwise
    expect(svg.match(/<rect/g)).toHaveLength(2); // the window and the symbol
    expect(svg.match(/<line/g)).toHaveLength(1); // the hidden wall is left out
  });
});

describe("renderDocumentPreview", () => {
  it("puts the plan on the page: the wall is black where the page was white", async () => {
    const blank = await sharp({ create: { width: 500, height: 300, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const out = await sharp(await renderDocumentPreview(blank, document)).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => out.data[(y * out.info.width + x) * out.info.channels];
    expect(at(150, 100)).toBe(0); // on the wall
    expect(at(150, 250)).toBe(255); // empty page
  });
});

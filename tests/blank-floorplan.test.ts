import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  BLANK_DRAWING_HEIGHT,
  BLANK_DRAWING_WIDTH,
  createBlankFloorplanImage,
} from "@/lib/image/blank-floorplan";
import { SM_BEIGE_RGB } from "@/lib/sm-floorplan-layout";

async function pixelAt(buffer: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
}

describe("createBlankFloorplanImage", () => {
  it("is a 7:5 brand canvas around an empty drawing slot of the full size", async () => {
    const blank = await createBlankFloorplanImage();
    const metadata = await sharp(blank.output).metadata();

    expect(metadata.width).toBe(blank.canvasWidth);
    expect(metadata.height).toBe(blank.canvasHeight);
    expect(blank.canvasWidth * 5).toBe(blank.canvasHeight * 7);
    expect(blank.imageWidth).toBe(BLANK_DRAWING_WIDTH);
    expect(blank.imageHeight).toBe(BLANK_DRAWING_HEIGHT);
  });

  it("is beige inside the slot and draws the frame", async () => {
    const blank = await createBlankFloorplanImage();
    const centre = await pixelAt(
      blank.output,
      blank.imageX + Math.floor(blank.imageWidth / 2),
      blank.imageY + Math.floor(blank.imageHeight / 2),
    );
    const frameEdge = blank.metrics.frameInset + Math.floor(blank.metrics.frameStroke / 2);
    const frame = await pixelAt(blank.output, Math.floor(blank.canvasWidth / 2), frameEdge);

    expect(centre).toEqual({ r: SM_BEIGE_RGB.r, g: SM_BEIGE_RGB.g, b: SM_BEIGE_RGB.b });
    expect(frame).toEqual({ r: 0, g: 0, b: 0 });
  });
});

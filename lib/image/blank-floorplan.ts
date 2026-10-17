import sharp from "sharp";

import { composeBrandedFloorplan } from "@/lib/image/brand-floorplan";
import { SM_BEIGE_RGB } from "@/lib/sm-floorplan-layout";

/**
 * The empty drawing area. Twice the 1200 px the brand layout was designed at, so the canvas
 * (about 3000 px wide) is as sharp as the ~2900 px reference plans; the layout scales with it.
 */
export const BLANK_DRAWING_WIDTH = 2400;
export const BLANK_DRAWING_HEIGHT = 1600;

/**
 * The brand canvas — beige, frame, logo — around an empty drawing area. A blank plan is stored
 * as an ordinary approved plan with this as its image, so the editor, library, export and
 * publish all work on it unchanged.
 */
export async function createBlankFloorplanImage() {
  const drawing = await sharp({
    create: {
      width: BLANK_DRAWING_WIDTH,
      height: BLANK_DRAWING_HEIGHT,
      channels: 3,
      background: SM_BEIGE_RGB,
    },
  })
    .png()
    .toBuffer();

  // With no ink to find, the crop keeps the whole area, so the slot stays exactly this size.
  return composeBrandedFloorplan(drawing, { preserveTones: true });
}

import sharp from "sharp";

import type { FloorplanDocument, FloorplanObject } from "@/lib/floorplan/types";

/**
 * A quick picture of a plan from its document: walls, windows, door swings and the boxes of
 * stairs and fittings. A plan that has not been finished (Slutför) has no flattened picture, only
 * the blank page it is drawn on, so its thumbnail would look empty; this draws what is in it.
 * It is a preview, not the plan: no lettering, and symbols are plain boxes.
 */

const INK = "#000000";
const round = (value: number) => Math.round(value * 100) / 100;

function placed(object: FloorplanObject, content: string) {
  const transform = `translate(${round(object.x)} ${round(object.y)}) rotate(${round(object.rotation)}) scale(${object.scaleX ?? 1} ${object.scaleY ?? 1})`;
  return `<g transform="${transform}">${content}</g>`;
}

function shape(object: FloorplanObject): string {
  switch (object.type) {
    case "wall":
      return `<line x1="${round(object.x)}" y1="${round(object.y)}" x2="${round(object.x2)}" y2="${round(object.y2)}" stroke="${INK}" stroke-width="${round(object.strokeWidth)}"/>`;
    case "window":
      return placed(
        object,
        `<rect width="${round(object.width)}" height="${round(object.height)}" fill="#ffffff" stroke="${INK}" stroke-width="${object.strokeWidth}"/>`,
      );
    case "door": {
      // The hinge sits at the bottom of the outline; the leaf stands up from it and the swing
      // sweeps to the right or the left (see hingeInOutline in door.ts).
      const half = object.strokeWidth / 2;
      const hingeX = object.swing === "right" ? half : object.width + half;
      const hingeY = object.width + half;
      const side = object.swing === "right" ? 1 : -1;
      const sweep = object.swing === "right" ? 1 : 0;
      return placed(
        object,
        `<path d="M${round(hingeX)} ${round(hingeY)}V${round(hingeY - object.width)}A${round(object.width)} ${round(object.width)} 0 0 ${sweep} ${round(hingeX + side * object.width)} ${round(hingeY)}" fill="none" stroke="${INK}" stroke-width="${object.strokeWidth}"/>`,
      );
    }
    case "stair":
    case "symbol":
    case "furniture":
      return placed(
        object,
        `<rect width="${round(object.width)}" height="${round(object.height)}" fill="#ffffff" fill-opacity="0.6" stroke="${INK}" stroke-width="${object.type === "stair" ? object.strokeWidth : 2}"/>`,
      );
    default:
      return "";
  }
}

export function documentPreviewSvg(document: FloorplanDocument): string {
  const { width, height } = document.canvas;
  const body = document.objects
    .filter((object) => object.visible !== false)
    .map(shape)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
}

/** The blank page with the plan's contents drawn on it. */
export async function renderDocumentPreview(blankPage: Buffer, document: FloorplanDocument): Promise<Buffer> {
  return sharp(blankPage)
    .composite([{ input: Buffer.from(documentPreviewSvg(document)) }])
    .png()
    .toBuffer();
}

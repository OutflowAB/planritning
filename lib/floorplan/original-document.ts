import { createEmptyDocument } from "@/lib/floorplan/document-factory";
import type { FloorplanDocument } from "@/lib/floorplan/types";

/**
 * What "Original" returns a plan to: the plan as first created (an imported scan's walls and
 * fittings) when there is one, otherwise an empty drawing on the same page and scale. The
 * plan keeps its identity either way.
 */
export function originalDocument(current: FloorplanDocument, source: FloorplanDocument | null): FloorplanDocument {
  if (source) {
    return { ...source, meta: { ...source.meta, ...current.meta } };
  }

  return {
    ...createEmptyDocument({
      imageId: current.meta.imageId,
      imagePath: current.meta.imagePath,
      fileName: current.meta.fileName,
      canvasWidth: current.canvas.width,
      canvasHeight: current.canvas.height,
    }),
    // The page and its scale do not change when the drawing is cleared.
    ...(current.drawingArea ? { drawingArea: current.drawingArea } : {}),
    ...(current.scale ? { scale: current.scale } : {}),
  };
}

/** Plans started empty or from a LiDAR scan rather than from an upload. Not AI generations. */
export const BLANK_FLOORPLAN_PREFIX = "generated/blank-";

// Browsers cache the blank canvas; bump this whenever its image changes (size, layout, logo).
const BLANK_CANVAS_VERSION = 1;

export function buildFloorplanImageUrl(imageId: number, imagePath: string) {
  // A blank plan keeps its editable document after Slutför, so it is always drawn on the
  // untouched canvas; the stored image is the flattened result.
  if (imagePath.startsWith(BLANK_FLOORPLAN_PREFIX)) {
    return `/api/blank-floorplan?v=${BLANK_CANVAS_VERSION}`;
  }

  const params = new URLSearchParams({
    imageId: String(imageId),
    imagePath,
  });
  return `/api/floorplan-image?${params.toString()}`;
}

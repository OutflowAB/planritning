export function buildFloorplanImageUrl(imageId: number, imagePath: string) {
  const params = new URLSearchParams({
    imageId: String(imageId),
    imagePath,
  });
  return `/api/floorplan-image?${params.toString()}`;
}

export async function publishFloorplanImage(input: {
  imageId: number;
  imagePath: string;
  pngDataUrl: string;
}) {
  const response = await fetch("/api/publish-floorplan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = (await response.json()) as { message?: string };

  if (!response.ok) {
    throw new Error(data.message ?? "Kunde inte publicera planritningen.");
  }
}

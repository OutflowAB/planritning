"use client";

import { apiFetch } from "@/lib/api-client";

export async function publishFloorplanImage(input: {
  imageId: number;
  imagePath: string;
  pngDataUrl: string;
}) {
  await apiFetch("/api/publish-floorplan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

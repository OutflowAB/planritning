import type { SupabaseClient } from "@supabase/supabase-js";

import { BUCKET_NAME } from "@/lib/supabase-server";

/**
 * The phone's whole LiDAR mesh of a scan, for looking at the scan in 3D. It is never read into
 * the plan. It arrives compressed and in pieces, each under Vercel's 4.5 MB request limit, stored
 * as meshes/<image id>/<piece>-of-<pieces>.bin; joined, they are one deflate-compressed file.
 */
export const MESH_PREFIX = "meshes/";
export const MESH_PART_BYTES = 4_000_000;
// 30 pieces is 120 MB compressed, far more than a whole house.
export const MAX_MESH_PARTS = 30;

export const meshFolder = (imageId: number) => `${MESH_PREFIX}${imageId}`;
export const meshPartPath = (imageId: number, part: number, parts: number) => `${meshFolder(imageId)}/${part}-of-${parts}.bin`;

/** Every stored piece of a plan's mesh, whole or not. */
export async function meshPartPaths(supabase: SupabaseClient, imageId: number) {
  const { data } = await supabase.storage.from(BUCKET_NAME).list(meshFolder(imageId), { limit: 100 });
  return (data ?? []).map((file) => `${meshFolder(imageId)}/${file.name}`);
}

/** The pieces in order, or null unless every piece of the latest send is there. */
export function completeMesh(paths: string[]): string[] | null {
  const parts = paths
    .map((path) => /\/(\d+)-of-(\d+)\.bin$/.exec(path))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ path: match.input, part: Number(match[1]), parts: Number(match[2]) }));
  const total = parts[0]?.parts;
  if (!total || parts.some((piece) => piece.parts !== total)) return null;
  const ordered = Array.from({ length: total }, (_, index) => parts.find((piece) => piece.part === index)?.path);
  return ordered.every(Boolean) ? (ordered as string[]) : null;
}

/**
 * Builds the URL an image is served from. Safe on both server and client.
 *
 * The version is the storage eTag from the list API. With it in the URL the response can be
 * cached as immutable; without it the browser has to revalidate on each use.
 */
export type ImageVariant = "full" | "thumb";

export function imageUrl(id: number, variant: ImageVariant, version?: string | null): string {
  const params = new URLSearchParams({ id: String(id), variant });
  if (version) {
    params.set("v", version);
  }
  return `/api/image?${params.toString()}`;
}

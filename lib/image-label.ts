/** A name people give an image themselves, usually the property's address. */

export const IMAGE_LABEL_MAX_LENGTH = 120;
/** A house rarely has more floors than this; it bounds one request, not the archive. */
export const MAX_LABELLED_IDS = 50;

/** Trimmed, inner whitespace collapsed; empty means "no name". */
export function normaliseImageLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const label = value.replace(/\s+/g, " ").trim();
  return label.length > 0 ? label.slice(0, IMAGE_LABEL_MAX_LENGTH) : null;
}

/** Client side: names the given images. Resolves to false when the name could not be saved. */
export async function saveImageLabel(ids: number[], label: string | null): Promise<boolean> {
  const response = await fetch("/api/image-label", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, label }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

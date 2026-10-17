export function imageDisplayName(id: number): string {
  return `Bild ${id}`;
}

export function imageDownloadBaseName(id: number): string {
  return `bild-${id}`;
}

type NamedPlan = { id: number; address?: string | null; floor_label?: string | null };

/** "Storgatan 1 · ENTRÉPLAN" once the realtor has given an address, else "Bild 12". */
export function planDisplayName(plan: NamedPlan): string {
  const parts = [plan.address?.trim(), plan.floor_label?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : imageDisplayName(plan.id);
}

/** A file name from the plan's address and floor ("storgatan-1-entreplan"), else "bild-12". */
export function planDownloadBaseName(plan: NamedPlan): string {
  const slug = [plan.address, plan.floor_label]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/å|ä/g, "a")
    .replace(/ö/g, "o")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || imageDownloadBaseName(plan.id);
}

export function imageDownloadFileName(id: number, extension: string): string {
  const normalizedExtension = extension.replace(/^\./, "").toLowerCase() || "png";
  return `${imageDownloadBaseName(id)}.${normalizedExtension}`;
}

export function imageExtensionFromMimeType(mimeType: string | null | undefined): string | null {
  switch (mimeType?.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "application/pdf":
      return "pdf";
    default:
      return null;
  }
}

export function imageExtensionFromFilePath(filePath: string | null | undefined): string | null {
  if (!filePath) {
    return null;
  }

  const extension = filePath.split(".").pop()?.toLowerCase();
  if (!extension || extension.length > 5) {
    return null;
  }

  return extension;
}

export function resolveImageDownloadFileName(
  id: number,
  options: {
    mimeType?: string | null;
    filePath?: string | null;
    format?: string | null;
  } = {},
): string {
  if (options.format) {
    return imageDownloadFileName(id, options.format);
  }

  const extension =
    imageExtensionFromMimeType(options.mimeType) ??
    imageExtensionFromFilePath(options.filePath) ??
    "png";

  return imageDownloadFileName(id, extension);
}

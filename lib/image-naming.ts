export function imageDisplayName(id: number): string {
  return `Bild ${id}`;
}

export function imageDownloadBaseName(id: number): string {
  return `bild-${id}`;
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

export type CompareLayout = {
  canvasWidth: number;
  canvasHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  outerFrameInset: number;
  outerFrameStroke: number;
};

function parsePositiveInt(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed);
}

export function parseCompareLayoutFromHeaders(headers: Headers): CompareLayout | null {
  const canvasWidth = parsePositiveInt(headers.get("x-layout-canvas-width"));
  const canvasHeight = parsePositiveInt(headers.get("x-layout-canvas-height"));
  const imageX = parsePositiveInt(headers.get("x-layout-image-x"));
  const imageY = parsePositiveInt(headers.get("x-layout-image-y"));
  const imageWidth = parsePositiveInt(headers.get("x-layout-image-width"));
  const imageHeight = parsePositiveInt(headers.get("x-layout-image-height"));
  const outerFrameInset = parsePositiveInt(headers.get("x-layout-frame-inset"));
  const outerFrameStroke = parsePositiveInt(headers.get("x-layout-frame-stroke"));

  if (
    canvasWidth === null ||
    canvasHeight === null ||
    imageX === null ||
    imageY === null ||
    imageWidth === null ||
    imageHeight === null ||
    outerFrameInset === null ||
    outerFrameStroke === null
  ) {
    return null;
  }

  return {
    canvasWidth,
    canvasHeight,
    imageX,
    imageY,
    imageWidth,
    imageHeight,
    outerFrameInset,
    outerFrameStroke,
  };
}

async function loadOrientedBitmap(source: File | Blob) {
  return createImageBitmap(source, { imageOrientation: "from-image" });
}

export async function createAlignedCompareImage(source: File | Blob, layout: CompareLayout) {
  const bitmap = await loadOrientedBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close?.();
    throw new Error("Kunde inte skapa jämförelsebild.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);
  context.drawImage(
    bitmap,
    layout.imageX,
    layout.imageY,
    layout.imageWidth,
    layout.imageHeight,
  );

  bitmap.close?.();
  return canvas.toDataURL("image/png");
}

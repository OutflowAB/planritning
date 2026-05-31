export const COMPARE_RESPONSE_CONTENT_TYPE = "application/vnd.planritning.compare+png";

export type CompareLayout = {
  canvasWidth: number;
  canvasHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
  preparedWidth: number;
  preparedHeight: number;
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

function parseNonNegativeInt(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed);
}

export function parseCompareLayoutFromHeaders(headers: Headers): CompareLayout | null {
  const canvasWidth = parsePositiveInt(headers.get("x-layout-canvas-width"));
  const canvasHeight = parsePositiveInt(headers.get("x-layout-canvas-height"));
  const imageX = parseNonNegativeInt(headers.get("x-layout-image-x"));
  const imageY = parseNonNegativeInt(headers.get("x-layout-image-y"));
  const imageWidth = parsePositiveInt(headers.get("x-layout-image-width"));
  const imageHeight = parsePositiveInt(headers.get("x-layout-image-height"));
  const cropLeft = parseNonNegativeInt(headers.get("x-layout-crop-left"));
  const cropTop = parseNonNegativeInt(headers.get("x-layout-crop-top"));
  const cropWidth = parsePositiveInt(headers.get("x-layout-crop-width"));
  const cropHeight = parsePositiveInt(headers.get("x-layout-crop-height"));
  const preparedWidth = parsePositiveInt(headers.get("x-layout-prepared-width"));
  const preparedHeight = parsePositiveInt(headers.get("x-layout-prepared-height"));
  const outerFrameInset = parsePositiveInt(headers.get("x-layout-frame-inset"));
  const outerFrameStroke = parsePositiveInt(headers.get("x-layout-frame-stroke"));

  if (
    canvasWidth === null ||
    canvasHeight === null ||
    imageX === null ||
    imageY === null ||
    imageWidth === null ||
    imageHeight === null ||
    cropLeft === null ||
    cropTop === null ||
    cropWidth === null ||
    cropHeight === null ||
    preparedWidth === null ||
    preparedHeight === null ||
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
    cropLeft,
    cropTop,
    cropWidth,
    cropHeight,
    preparedWidth,
    preparedHeight,
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

  const preparedCanvas = document.createElement("canvas");
  preparedCanvas.width = layout.preparedWidth;
  preparedCanvas.height = layout.preparedHeight;

  const preparedContext = preparedCanvas.getContext("2d");
  if (!preparedContext) {
    bitmap.close?.();
    throw new Error("Kunde inte skapa jämförelsebild.");
  }

  preparedContext.drawImage(bitmap, 0, 0, layout.preparedWidth, layout.preparedHeight);
  bitmap.close?.();

  context.drawImage(
    preparedCanvas,
    layout.cropLeft,
    layout.cropTop,
    layout.cropWidth,
    layout.cropHeight,
    layout.imageX,
    layout.imageY,
    layout.imageWidth,
    layout.imageHeight,
  );

  return canvas.toDataURL("image/png");
}

const COMPARE_LENGTH_BYTES = 4;

export function packCompareResponse(compareBeforePng: Uint8Array, resultPng: Uint8Array) {
  const body = new Uint8Array(COMPARE_LENGTH_BYTES + compareBeforePng.byteLength + resultPng.byteLength);
  const view = new DataView(body.buffer);
  view.setUint32(0, compareBeforePng.byteLength, false);
  body.set(compareBeforePng, COMPARE_LENGTH_BYTES);
  body.set(resultPng, COMPARE_LENGTH_BYTES + compareBeforePng.byteLength);
  return body;
}

export function unpackCompareResponse(buffer: ArrayBuffer) {
  if (buffer.byteLength < COMPARE_LENGTH_BYTES) {
    throw new Error("Ogiltigt jämförelsesvar.");
  }

  const view = new DataView(buffer);
  const compareBeforeLength = view.getUint32(0, false);
  const compareBeforeEnd = COMPARE_LENGTH_BYTES + compareBeforeLength;

  if (compareBeforeEnd > buffer.byteLength) {
    throw new Error("Ogiltigt jämförelsesvar.");
  }

  const compareBeforePng = buffer.slice(COMPARE_LENGTH_BYTES, compareBeforeEnd);
  const resultPng = buffer.slice(compareBeforeEnd);

  if (compareBeforePng.byteLength === 0 || resultPng.byteLength === 0) {
    throw new Error("Ogiltigt jämförelsesvar.");
  }

  return { compareBeforePng, resultPng };
}

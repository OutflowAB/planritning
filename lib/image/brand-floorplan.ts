import path from "node:path";
import sharp from "sharp";

import { cropToMainContent, type CropBoundingBox } from "@/lib/image/smart-crop";

/**
 * How wide the drawing is worked at. This is what decides how many pixels each room label
 * gets, and image models render text badly when glyphs are only a few pixels tall — so it is
 * the main lever on text quality. Raising it raises the OpenAI cost roughly with the pixel
 * count.
 */
export const TARGET_MAX_WIDTH = 2560;
export const LINE_THRESHOLD = 190;

export const ASPECT_RATIO_WIDTH = 7;
export const ASPECT_RATIO_HEIGHT = 5;
export const LOGO_WIDTH_RATIO = 0.3;

/**
 * The layout was designed against a 1200px-wide drawing, and every spacing below is a pixel
 * value from that design. They are derived from the drawing's actual width rather than stored
 * as constants, because a constant tuned for one resolution silently shrinks the logo, the
 * frame and the margins the moment the working resolution changes.
 */
const LAYOUT_REFERENCE_WIDTH = 1200;

export type LayoutMetrics = {
  contentPadding: number;
  logoGap: number;
  logoMaxWidth: number;
  frameStroke: number;
  frameInset: number;
};

export function resolveLayoutMetrics(drawingWidth: number): LayoutMetrics {
  const scale = Math.max(1, drawingWidth / LAYOUT_REFERENCE_WIDTH);
  const scaled = (value: number) => Math.round(value * scale);

  return {
    contentPadding: scaled(80),
    logoGap: scaled(44),
    logoMaxWidth: scaled(360),
    frameStroke: scaled(3),
    frameInset: scaled(30),
  };
}
const BEIGE_BACKGROUND = { r: 225, g: 212, b: 200, alpha: 1 };

export type BrandedFloorplanLayout = {
  canvasWidth: number;
  canvasHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  crop: CropBoundingBox;
  preparedWidth: number;
  preparedHeight: number;
};

export type BrandedFloorplanResult = BrandedFloorplanLayout & {
  output: Buffer;
  metrics: LayoutMetrics;
};

export type Rgb = { r: number; g: number; b: number };

export type ComposeBrandedFloorplanOptions = {
  /**
   * Keep the drawing's anti-aliasing instead of snapping every pixel to black or white, and
   * leave its colours alone. Use it when the drawing already carries the house style: the
   * threshold turns every soft edge into a staircase and the beige tint would double up on a
   * background that is already beige. Photos still need both to become brand output.
   */
  preserveTones?: boolean;
  /**
   * Colour used to pad the drawing out to the 7:5 canvas. Pass the drawing's own background
   * so the padding is seamless; without it the canvas falls back to the brand beige.
   */
  backgroundColor?: Rgb;
};

/**
 * The most common colour in an image. On a floor plan the background covers the large
 * majority of the pixels, so this finds it reliably without needing to guess where to sample.
 */
export async function sampleDominantColor(imageBuffer: Buffer): Promise<Rgb> {
  const { data, info } = await sharp(imageBuffer)
    .resize({ width: 200, height: 200, fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const counts = new Map<number, number>();
  const pixels = info.width * info.height;

  for (let index = 0; index < pixels; index += 1) {
    const offset = index * info.channels;
    const key = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let dominant = -1;
  let best = 0;
  for (const [key, count] of counts) {
    if (count > best) {
      best = count;
      dominant = key;
    }
  }

  if (dominant < 0) {
    return { r: BEIGE_BACKGROUND.r, g: BEIGE_BACKGROUND.g, b: BEIGE_BACKGROUND.b };
  }

  return {
    r: (dominant >> 16) & 255,
    g: (dominant >> 8) & 255,
    b: dominant & 255,
  };
}

/** Normalise any uploaded photo to the orientation and width the rest of the pipeline expects. */
export async function prepareSourceImage(inputBuffer: Buffer) {
  return sharp(inputBuffer)
    .rotate()
    .resize({
      width: TARGET_MAX_WIDTH,
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}

/**
 * Turn a line drawing into the branded floor plan: pure black lines on the beige canvas,
 * centred above the logo inside the outer frame.
 */
export async function composeBrandedFloorplan(
  drawingBuffer: Buffer,
  { preserveTones = false, backgroundColor }: ComposeBrandedFloorplanOptions = {},
): Promise<BrandedFloorplanResult> {
  const thresholdedImageBuffer = await sharp(drawingBuffer)
    .grayscale()
    .threshold(LINE_THRESHOLD)
    .png()
    .toBuffer();

  // The thresholded copy is always what locates the drawing, because the bounding box needs a
  // clean ink/paper split. What gets composited is a separate question.
  const cropResult = await cropToMainContent(thresholdedImageBuffer);
  const processedImageBuffer = preserveTones
    ? await sharp(drawingBuffer).extract(cropResult.boundingBox).png().toBuffer()
    : cropResult.buffer;

  const processedMetadata = await sharp(processedImageBuffer).metadata();
  const imageWidth = processedMetadata.width;
  const imageHeight = processedMetadata.height;

  if (!imageWidth || !imageHeight) {
    throw new Error("Kunde inte läsa bildens storlek.");
  }

  const canvasBackground = backgroundColor
    ? { ...backgroundColor, alpha: 1 }
    : BEIGE_BACKGROUND;

  // A drawing that already carries the house colours is composited as it is. Only a black and
  // white photo needs the beige laid over it to become brand output.
  const beigeOverlay = Buffer.from(
    `<svg width="${imageWidth}" height="${imageHeight}">
        <rect width="100%" height="100%" fill="rgb(${BEIGE_BACKGROUND.r},${BEIGE_BACKGROUND.g},${BEIGE_BACKGROUND.b})" />
      </svg>`,
  );

  const beigeTintedImageBuffer = preserveTones
    ? processedImageBuffer
    : await sharp(processedImageBuffer)
        .composite([
          {
            input: beigeOverlay,
            blend: "multiply",
          },
        ])
        .png()
        .toBuffer();

  const layout = resolveLayoutMetrics(imageWidth);

  const logoFilePath = path.join(process.cwd(), "public", "sm-logo.svg");
  const desiredLogoWidth = Math.min(
    layout.logoMaxWidth,
    Math.round(imageWidth * LOGO_WIDTH_RATIO),
  );
  const logoBuffer = await sharp(logoFilePath)
    .resize({
      width: desiredLogoWidth,
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const logoMetadata = await sharp(logoBuffer).metadata();
  const logoWidth = logoMetadata.width;
  const logoHeight = logoMetadata.height;

  if (!logoWidth || !logoHeight) {
    throw new Error("Kunde inte läsa loggans storlek.");
  }

  const contentWidth = Math.max(imageWidth, logoWidth);
  const contentHeight = imageHeight + layout.logoGap + logoHeight;
  const minCanvasWidth = contentWidth + layout.contentPadding * 2;
  const minCanvasHeight = contentHeight + layout.contentPadding * 2;
  const canvasScale = Math.ceil(
    Math.max(minCanvasWidth / ASPECT_RATIO_WIDTH, minCanvasHeight / ASPECT_RATIO_HEIGHT),
  );
  const canvasWidth = canvasScale * ASPECT_RATIO_WIDTH;
  const canvasHeight = canvasScale * ASPECT_RATIO_HEIGHT;

  const imageX = Math.floor((canvasWidth - imageWidth) / 2);
  const contentTop = Math.floor((canvasHeight - contentHeight) / 2);
  const imageY = contentTop;
  const logoX = Math.floor((canvasWidth - logoWidth) / 2);
  const logoY = imageY + imageHeight + layout.logoGap;
  const frameOverlay = Buffer.from(
    `<svg width="${canvasWidth}" height="${canvasHeight}">
        <rect
          x="${layout.frameInset + layout.frameStroke / 2}"
          y="${layout.frameInset + layout.frameStroke / 2}"
          width="${canvasWidth - layout.frameInset * 2 - layout.frameStroke}"
          height="${canvasHeight - layout.frameInset * 2 - layout.frameStroke}"
          fill="none"
          stroke="#000000"
          stroke-width="${layout.frameStroke}"
        />
      </svg>`,
  );

  const output = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: canvasBackground,
    },
  })
    .composite([
      {
        input: beigeTintedImageBuffer,
        left: imageX,
        top: imageY,
      },
      {
        input: logoBuffer,
        left: logoX,
        top: logoY,
      },
      {
        input: frameOverlay,
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

  return {
    output,
    metrics: layout,
    canvasWidth,
    canvasHeight,
    imageX,
    imageY,
    imageWidth,
    imageHeight,
    crop: cropResult.boundingBox,
    preparedWidth: cropResult.preparedWidth,
    preparedHeight: cropResult.preparedHeight,
  };
}

/** The white "before" image, aligned pixel for pixel with the branded result. */
export async function buildCompareBefore(
  orientedColorBuffer: Buffer,
  layout: BrandedFloorplanLayout,
): Promise<Buffer> {
  const croppedOriginalBuffer = await sharp(orientedColorBuffer)
    .extract({
      left: layout.crop.left,
      top: layout.crop.top,
      width: layout.crop.width,
      height: layout.crop.height,
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: layout.canvasWidth,
      height: layout.canvasHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      {
        input: croppedOriginalBuffer,
        left: layout.imageX,
        top: layout.imageY,
      },
    ])
    .png()
    .toBuffer();
}

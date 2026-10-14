import path from "node:path";
import sharp from "sharp";

import { compassSvg } from "@/lib/image/sheet-compass";
import { sheetTextSvg } from "@/lib/image/sheet-font";
import { cropToMainContent, type CropBoundingBox } from "@/lib/image/smart-crop";

/**
 * How wide the drawing is worked at. This is what decides how many pixels each room label
 * gets, and image models render text badly when glyphs are only a few pixels tall — so it is
 * the main lever on text quality. Raising it raises the OpenAI cost roughly with the pixel
 * count.
 */
export const TARGET_MAX_WIDTH = 2560;
export const LINE_THRESHOLD = 190;

/**
 * The sheet is A4 portrait, like the house-style references (2879 x 4071 px): height is the
 * width times √2, rounded to a whole pixel.
 */
export const A4_HEIGHT_PER_WIDTH = Math.SQRT2;

/**
 * Every position on the sheet is a fraction of the canvas width (read off the references),
 * so the frame, heading, compass and logo keep their proportions whatever resolution the
 * drawing is worked at. A pixel constant tuned for one resolution silently shrinks them the
 * moment that resolution changes.
 */
const SHEET = {
  frameInset: 0.02,
  frameStroke: 0.0014,
  headingCenterY: 0.095,
  headingSize: 0.031,
  headingLetterSpacingEm: 0.05,
  compassCenterX: 0.924,
  compassCenterY: 0.076,
  compassRadius: 0.05,
  logoWidth: 0.24,
  /** Logo centre, as a fraction of the sheet height. */
  logoCenterY: 0.932,
  /** The drawing may use this part of the sheet: between the heading and the logo. */
  areaTop: 0.13,
  areaBottom: 0.88,
  areaWidth: 0.84,
} as const;

export type LayoutMetrics = {
  logoWidth: number;
  logoCenterY: number;
  frameStroke: number;
  frameInset: number;
  headingCenterY: number;
  headingSize: number;
  compassCenterX: number;
  compassCenterY: number;
  compassRadius: number;
  /** The slot the drawing is centred in. */
  areaTop: number;
  areaHeight: number;
};

export function resolveLayoutMetrics(canvasWidth: number): LayoutMetrics {
  const canvasHeight = Math.round(canvasWidth * A4_HEIGHT_PER_WIDTH);
  const px = (fraction: number) => Math.round(canvasWidth * fraction);

  return {
    logoWidth: px(SHEET.logoWidth),
    logoCenterY: Math.round(canvasHeight * SHEET.logoCenterY),
    frameStroke: Math.max(2, px(SHEET.frameStroke)),
    frameInset: px(SHEET.frameInset),
    headingCenterY: px(SHEET.headingCenterY),
    headingSize: px(SHEET.headingSize),
    compassCenterX: px(SHEET.compassCenterX),
    compassCenterY: px(SHEET.compassCenterY),
    compassRadius: px(SHEET.compassRadius),
    areaTop: Math.round(canvasHeight * SHEET.areaTop),
    areaHeight: Math.round(canvasHeight * (SHEET.areaBottom - SHEET.areaTop)),
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
   * Colour used to pad the drawing out to the A4 canvas. Pass the drawing's own background
   * so the padding is seamless; without it the canvas falls back to the brand beige.
   */
  backgroundColor?: Rgb;
  /**
   * Draws the compass rose, with north this many degrees clockwise from the top of the sheet.
   * Leave it out when no direction is known (photo uploads): a compass that guesses is worse
   * than none.
   */
  compassRotationDegrees?: number | null;
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
 * centred between the heading and the logo, inside the outer frame, on an A4 portrait sheet.
 */
export async function composeBrandedFloorplan(
  drawingBuffer: Buffer,
  { preserveTones = false, backgroundColor, compassRotationDegrees = null }: ComposeBrandedFloorplanOptions = {},
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

  // The canvas is sized from the drawing: the smallest A4 sheet whose drawing slot holds it,
  // so the drawing is never scaled and its aspect ratio is kept.
  const slotHeightRatio = SHEET.areaBottom - SHEET.areaTop;
  const canvasWidth = Math.ceil(
    Math.max(
      imageWidth / SHEET.areaWidth,
      imageHeight / (slotHeightRatio * A4_HEIGHT_PER_WIDTH),
    ),
  );
  const canvasHeight = Math.round(canvasWidth * A4_HEIGHT_PER_WIDTH);
  const layout = resolveLayoutMetrics(canvasWidth);

  const logoFilePath = path.join(process.cwd(), "public", "sm-logo.svg");
  const logoBuffer = await sharp(logoFilePath)
    .resize({ width: layout.logoWidth })
    .png()
    .toBuffer();
  const logoMetadata = await sharp(logoBuffer).metadata();
  const logoWidth = logoMetadata.width;
  const logoHeight = logoMetadata.height;

  if (!logoWidth || !logoHeight) {
    throw new Error("Kunde inte läsa loggans storlek.");
  }

  const imageX = Math.floor((canvasWidth - imageWidth) / 2);
  const imageY = layout.areaTop + Math.floor((layout.areaHeight - imageHeight) / 2);
  const logoX = Math.floor((canvasWidth - logoWidth) / 2);
  const logoY = layout.logoCenterY - Math.floor(logoHeight / 2);

  // Frame, heading and compass are one SVG overlay. The text is outlines, not <text>, so no
  // font has to exist on the server.
  const frameOverlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
        <rect
          x="${layout.frameInset + layout.frameStroke / 2}"
          y="${layout.frameInset + layout.frameStroke / 2}"
          width="${canvasWidth - layout.frameInset * 2 - layout.frameStroke}"
          height="${canvasHeight - layout.frameInset * 2 - layout.frameStroke}"
          fill="none"
          stroke="#000000"
          stroke-width="${layout.frameStroke}"
        />
        ${sheetTextSvg("PLANLÖSNING", {
          centerX: canvasWidth / 2,
          centerY: layout.headingCenterY,
          size: layout.headingSize,
          letterSpacingEm: SHEET.headingLetterSpacingEm,
        })}
        ${
          compassRotationDegrees === null
            ? ""
            : compassSvg(
                layout.compassCenterX,
                layout.compassCenterY,
                layout.compassRadius,
                compassRotationDegrees,
              )
        }
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
export type BuildCompareBeforeOptions = {
  /**
   * Cut the original with the drawing's crop box. Only valid when the drawing *is* the
   * original — the algorithm path. An AI drawing places and scales the plan freely, so its
   * box lands somewhere else on the original and lops parts of it off. There the whole
   * original is fitted into the drawing's slot instead.
   */
  cropToDrawing?: boolean;
};

/** The part of a layout the before image needs. `crop` is only read when cropping. */
export type CompareSlotLayout = Pick<
  BrandedFloorplanLayout,
  "canvasWidth" | "canvasHeight" | "imageX" | "imageY" | "imageWidth" | "imageHeight"
> & { crop?: CropBoundingBox };

export async function buildCompareBefore(
  orientedColorBuffer: Buffer,
  layout: CompareSlotLayout,
  { cropToDrawing = true }: BuildCompareBeforeOptions = {},
): Promise<Buffer> {
  let beforeBuffer: Buffer;
  let left = layout.imageX;
  let top = layout.imageY;

  if (cropToDrawing) {
    if (!layout.crop) {
      throw new Error("buildCompareBefore: crop box required when cropping to the drawing.");
    }

    beforeBuffer = await sharp(orientedColorBuffer)
      .extract({
        left: layout.crop.left,
        top: layout.crop.top,
        width: layout.crop.width,
        height: layout.crop.height,
      })
      .png()
      .toBuffer();
  } else {
    beforeBuffer = await sharp(orientedColorBuffer)
      .resize({
        width: layout.imageWidth,
        height: layout.imageHeight,
        fit: "inside",
      })
      .png()
      .toBuffer();

    // Centre the fitted original in the slot so it sits where the drawing sits.
    const fitted = await sharp(beforeBuffer).metadata();
    left += Math.floor((layout.imageWidth - (fitted.width ?? layout.imageWidth)) / 2);
    top += Math.floor((layout.imageHeight - (fitted.height ?? layout.imageHeight)) / 2);
  }

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
        input: beforeBuffer,
        left,
        top,
      },
    ])
    .png()
    .toBuffer();
}

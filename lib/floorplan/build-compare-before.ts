import path from "node:path";
import sharp from "sharp";

import {
  ASPECT_RATIO_HEIGHT,
  ASPECT_RATIO_WIDTH,
  LINE_THRESHOLD,
  LOGO_WIDTH_RATIO,
  TARGET_MAX_WIDTH,
  resolveLayoutMetrics,
} from "@/lib/image/brand-floorplan";
import { cropToMainContent } from "@/lib/image/smart-crop";

export async function buildCompareBeforeImage(inputBuffer: Buffer) {
  const orientedColorBuffer = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: TARGET_MAX_WIDTH,
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  const thresholdedImageBuffer = await sharp(orientedColorBuffer)
    .grayscale()
    .threshold(LINE_THRESHOLD)
    .png()
    .toBuffer();

  const cropResult = await cropToMainContent(thresholdedImageBuffer);
  const processedMetadata = await sharp(cropResult.buffer).metadata();
  const imageWidth = processedMetadata.width;
  const imageHeight = processedMetadata.height;

  if (!imageWidth || !imageHeight) {
    throw new Error("Kunde inte läsa bildens storlek.");
  }

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

  const croppedOriginalBuffer = await sharp(orientedColorBuffer)
    .extract({
      left: cropResult.boundingBox.left,
      top: cropResult.boundingBox.top,
      width: cropResult.boundingBox.width,
      height: cropResult.boundingBox.height,
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      {
        input: croppedOriginalBuffer,
        left: imageX,
        top: imageY,
      },
    ])
    .png()
    .toBuffer();
}

import { existsSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { composeBrandedFloorplan, resolveLayoutMetrics } from "@/lib/image/brand-floorplan";
import { SHEET_FONT_PATH } from "@/lib/image/sheet-font";

const BEIGE = { r: 225, g: 212, b: 200 };

/** A wide room outline on beige, like the AI drawing the sheet is built around. */
async function drawing(width = 1200, height = 800) {
  return sharp({ create: { width, height, channels: 3, background: BEIGE } })
    .composite([
      {
        input: await sharp({
          create: { width: width - 200, height: height - 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
        })
          .png()
          .toBuffer(),
        left: 100,
        top: 100,
      },
      {
        input: await sharp({
          create: { width: width - 240, height: height - 240, channels: 3, background: BEIGE },
        })
          .png()
          .toBuffer(),
        left: 120,
        top: 120,
      },
    ])
    .png()
    .toBuffer();
}

/** How many pixels in a region differ from the sheet background. */
async function inkIn(png: Buffer, region: { left: number; top: number; width: number; height: number }) {
  const { data, info } = await sharp(png).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 3;
    if (data[offset] < 120 && data[offset + 1] < 120 && data[offset + 2] < 120) count += 1;
  }
  return count;
}

describe("branded sheet", () => {
  let source: Buffer;
  beforeAll(async () => {
    source = await drawing();
  });

  it("is A4 portrait", async () => {
    const result = await composeBrandedFloorplan(source, { preserveTones: true, backgroundColor: BEIGE });
    const meta = await sharp(result.output).metadata();
    expect(meta.width).toBe(result.canvasWidth);
    expect(meta.height).toBe(result.canvasHeight);
    expect(Math.abs((meta.width as number) * Math.SQRT2 - (meta.height as number))).toBeLessThanOrEqual(1);
    expect(meta.height as number).toBeGreaterThan(meta.width as number);
  });

  it("keeps the drawing whole, centred between heading and logo", async () => {
    const result = await composeBrandedFloorplan(source, { preserveTones: true, backgroundColor: BEIGE });
    const layout = resolveLayoutMetrics(result.canvasWidth);
    expect(result.imageWidth).toBeLessThanOrEqual(result.canvasWidth * 0.84);
    expect(result.imageY).toBeGreaterThanOrEqual(layout.areaTop);
    expect(result.imageY + result.imageHeight).toBeLessThanOrEqual(layout.areaTop + layout.areaHeight);
    expect(Math.abs(result.imageX * 2 + result.imageWidth - result.canvasWidth)).toBeLessThanOrEqual(1);
  });

  it("writes the heading at the top", async () => {
    const result = await composeBrandedFloorplan(source, { preserveTones: true, backgroundColor: BEIGE });
    const layout = resolveLayoutMetrics(result.canvasWidth);
    const band = {
      left: Math.round(result.canvasWidth * 0.3),
      top: layout.headingCenterY - layout.headingSize,
      width: Math.round(result.canvasWidth * 0.4),
      height: layout.headingSize * 2,
    };
    expect(await inkIn(result.output, band)).toBeGreaterThan(200);
  });

  it("draws the compass only when a direction is given", async () => {
    const without = await composeBrandedFloorplan(source, { preserveTones: true, backgroundColor: BEIGE });
    const withCompass = await composeBrandedFloorplan(source, {
      preserveTones: true,
      backgroundColor: BEIGE,
      compassRotationDegrees: 51.37,
    });
    const layout = resolveLayoutMetrics(without.canvasWidth);
    const box = {
      left: layout.compassCenterX - layout.compassRadius,
      top: layout.compassCenterY - layout.compassRadius,
      width: layout.compassRadius * 2,
      height: layout.compassRadius * 2,
    };
    expect(await inkIn(without.output, box)).toBe(0);
    expect(await inkIn(withCompass.output, box)).toBeGreaterThan(100);
    // Same sheet either way: the compass changes nothing else.
    expect(withCompass.canvasWidth).toBe(without.canvasWidth);
  });

  it("treats an explicit null like no compass", async () => {
    const result = await composeBrandedFloorplan(source, { compassRotationDegrees: null });
    const layout = resolveLayoutMetrics(result.canvasWidth);
    expect(
      await inkIn(result.output, {
        left: layout.compassCenterX - layout.compassRadius,
        top: layout.compassCenterY - layout.compassRadius,
        width: layout.compassRadius * 2,
        height: layout.compassRadius * 2,
      }),
    ).toBe(0);
  });

  it("works for a tall drawing too", async () => {
    const result = await composeBrandedFloorplan(await drawing(500, 1400), {
      preserveTones: true,
      backgroundColor: BEIGE,
    });
    const layout = resolveLayoutMetrics(result.canvasWidth);
    expect(result.imageY + result.imageHeight).toBeLessThanOrEqual(layout.areaTop + layout.areaHeight);
  });
});

describe("sheet font", () => {
  it("is bundled and resolved from the project root, as Vercel tracing expects", () => {
    expect(path.isAbsolute(SHEET_FONT_PATH)).toBe(true);
    expect(SHEET_FONT_PATH).toBe(path.join(process.cwd(), "assets", "fonts", path.basename(SHEET_FONT_PATH)));
    expect(existsSync(SHEET_FONT_PATH)).toBe(true);
    expect(existsSync(path.join(process.cwd(), "assets", "fonts", "Questrial-OFL.txt"))).toBe(true);
  });
});

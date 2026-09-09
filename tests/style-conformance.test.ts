import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { measureStyleDeviation } from "@/lib/image/style-conformance";

const REFERENCE_DIR = path.resolve(__dirname, "../assets/style-references");
const THRESHOLD = 0.25;

const references = readdirSync(REFERENCE_DIR)
  .filter((name) => name.endsWith(".webp"))
  .sort()
  .map((name) => ({ name, buffer: readFileSync(path.join(REFERENCE_DIR, name)) }));

describe("measureStyleDeviation", () => {
  it("has reference plans to measure against", () => {
    expect(references.length).toBeGreaterThanOrEqual(3);
  });

  it.each(references.map((reference) => [reference.name, reference.buffer] as const))(
    "passes approved reference %s with margin",
    async (_name, buffer) => {
      const { score } = await measureStyleDeviation(buffer);
      // Leaves at least ten points between the worst approved plan and the redraw threshold.
      expect(score).toBeLessThan(THRESHOLD - 0.1);
    },
  );

  it("flags a greyscale result", async () => {
    const grey = await sharp(references[0].buffer).grayscale().png().toBuffer();
    const { score, issues } = await measureStyleDeviation(grey);
    expect(score).toBeGreaterThan(THRESHOLD);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("flags a tinted background", async () => {
    const tinted = await sharp(references[0].buffer).tint({ r: 180, g: 200, b: 255 }).png().toBuffer();
    expect((await measureStyleDeviation(tinted)).score).toBeGreaterThan(THRESHOLD);
  });

  it("flags a hard-thresholded result", async () => {
    const stepped = await sharp(references[0].buffer).grayscale().threshold(190).png().toBuffer();
    expect((await measureStyleDeviation(stepped)).score).toBeGreaterThan(THRESHOLD);
  });

  // A blank canvas is the right colour and would pass every palette metric.
  it("treats an empty canvas as a total failure", async () => {
    const blank = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 225, g: 213, b: 201 } },
    })
      .png()
      .toBuffer();
    const { score, issues } = await measureStyleDeviation(blank);
    expect(score).toBe(1);
    expect(issues[0]).toMatch(/tom/i);
  });

  it("flags a nearly black result", async () => {
    const dark = await sharp(references[0].buffer).linear(0.2, 0).png().toBuffer();
    expect((await measureStyleDeviation(dark)).score).toBeGreaterThan(THRESHOLD);
  });
});

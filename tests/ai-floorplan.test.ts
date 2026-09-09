import { describe, expect, it } from "vitest";

import { resolveGeneratedSize } from "@/lib/image/ai-floorplan";

/** Limits documented by the image API for gpt-image-2. */
const MAX_PIXELS = 8_294_400;
const MIN_PIXELS = 655_360;
const MAX_EDGE = 3840;

describe("resolveGeneratedSize", () => {
  it.each([
    [2560, 1920],
    [1930, 1370],
    [2560, 2560],
    [638, 480],
    [2560, 853],
    [4000, 800],
    [800, 4000],
    [1, 1],
    [3000, 999],
    [1200, 1],
  ])("%ix%i stays inside the API's limits", (width, height) => {
    const size = resolveGeneratedSize(width, height);
    const pixels = size.width * size.height;
    const ratio = size.width / size.height;

    expect(size.width % 16).toBe(0);
    expect(size.height % 16).toBe(0);
    expect(ratio).toBeLessThanOrEqual(3);
    expect(ratio).toBeGreaterThanOrEqual(1 / 3);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_EDGE);
    expect(pixels).toBeLessThanOrEqual(MAX_PIXELS);
    expect(pixels).toBeGreaterThanOrEqual(MIN_PIXELS);
  });

  it("keeps the source orientation", () => {
    expect(resolveGeneratedSize(2000, 1000).width).toBeGreaterThan(resolveGeneratedSize(2000, 1000).height);
    expect(resolveGeneratedSize(1000, 2000).height).toBeGreaterThan(resolveGeneratedSize(1000, 2000).width);
  });

  // Regression: rounding the short edge to nearest pushed 2560x853 to 2560x848, ratio 3.019,
  // which the API rejects with 400.
  it("never rounds an elongated plan past 3:1", () => {
    const size = resolveGeneratedSize(2560, 853);
    expect(size.width / size.height).toBeLessThanOrEqual(3);
  });
});

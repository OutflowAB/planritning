/**
 * Lines the original up with the new drawing in the compare slider.
 *
 * The "before" image has the whole original fitted into the slot the new drawing occupies,
 * but an original carries margins, title blocks and its own scale, so its walls rarely sit
 * where the new walls are. Here both images are searched for their walls — long, dark,
 * straight runs; text and symbols are too short to count — and the original is stretched and
 * moved so its walls cover the same box as the new ones. The original's sharpness is
 * expendable; seeing exactly what changed is the point.
 *
 * Pure and synchronous: it works on a greyscale buffer, so it can be tested without a browser.
 */

export type Box = { x: number; y: number; width: number; height: number };

/** How to move the original: `p' = p * scale + translate`, all in fractions of the image. */
export type CompareAlignment = {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
};

export type GreyImage = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

/** A run of dark pixels at least this share of the searched region counts as a wall. */
const MIN_RUN_SHARE = 0.04;
/** Share of wall pixels ignored at each edge, so a stray line does not stretch the box. */
const TRIM_SHARE = 0.01;
/** A box smaller than this share of the region is a misread, not a plan. */
const MIN_BOX_SHARE = 0.1;
/** Stretching beyond this, either way, means the two boxes are not the same plan. */
const MAX_SCALE = 4;

function percentile(sorted: number[], share: number) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))));
  return sorted[index];
}

/**
 * The box around an image's walls, in pixels, searched within `region` (whole image if
 * omitted). Null when there are no walls to speak of.
 */
export function findWallBox(image: GreyImage, region?: Box): Box | null {
  const left = Math.max(0, Math.floor(region?.x ?? 0));
  const top = Math.max(0, Math.floor(region?.y ?? 0));
  const right = Math.min(image.width, Math.ceil((region?.x ?? 0) + (region?.width ?? image.width)));
  const bottom = Math.min(image.height, Math.ceil((region?.y ?? 0) + (region?.height ?? image.height)));
  const regionWidth = right - left;
  const regionHeight = bottom - top;
  if (regionWidth < 8 || regionHeight < 8) {
    return null;
  }

  // Dark relative to the paper, whatever colour the paper is: well below the median.
  const sample: number[] = [];
  const stride = Math.max(1, Math.floor((regionWidth * regionHeight) / 4000));
  for (let index = 0; index < regionWidth * regionHeight; index += stride) {
    const x = left + (index % regionWidth);
    const y = top + Math.floor(index / regionWidth);
    sample.push(image.data[y * image.width + x]);
  }
  sample.sort((a, b) => a - b);
  const threshold = Math.min(150, percentile(sample, 0.5) - 60);
  if (threshold <= 0) {
    return null;
  }
  const isDark = (x: number, y: number) => image.data[y * image.width + x] < threshold;

  const minHorizontalRun = Math.max(3, Math.round(regionWidth * MIN_RUN_SHARE));
  const minVerticalRun = Math.max(3, Math.round(regionHeight * MIN_RUN_SHARE));
  const xs: number[] = [];
  const ys: number[] = [];

  for (let y = top; y < bottom; y += 1) {
    let runStart = -1;
    for (let x = left; x <= right; x += 1) {
      if (x < right && isDark(x, y)) {
        if (runStart < 0) runStart = x;
        continue;
      }
      if (runStart >= 0 && x - runStart >= minHorizontalRun) {
        xs.push(runStart, x - 1);
        ys.push(y, y);
      }
      runStart = -1;
    }
  }
  for (let x = left; x < right; x += 1) {
    let runStart = -1;
    for (let y = top; y <= bottom; y += 1) {
      if (y < bottom && isDark(x, y)) {
        if (runStart < 0) runStart = y;
        continue;
      }
      if (runStart >= 0 && y - runStart >= minVerticalRun) {
        xs.push(x, x);
        ys.push(runStart, y - 1);
      }
      runStart = -1;
    }
  }

  if (xs.length === 0) {
    return null;
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const box = {
    x: percentile(xs, TRIM_SHARE),
    y: percentile(ys, TRIM_SHARE),
    width: percentile(xs, 1 - TRIM_SHARE) - percentile(xs, TRIM_SHARE) + 1,
    height: percentile(ys, 1 - TRIM_SHARE) - percentile(ys, TRIM_SHARE) + 1,
  };
  if (box.width < regionWidth * MIN_BOX_SHARE || box.height < regionHeight * MIN_BOX_SHARE) {
    return null;
  }
  return box;
}

/**
 * The move that lays `before`'s walls over `after`'s. Both boxes are fractions of their image
 * (the two images are shown at the same size). Null when the result would be a distortion
 * rather than an alignment.
 */
export function alignBoxes(before: Box, after: Box): CompareAlignment | null {
  const scaleX = after.width / before.width;
  const scaleY = after.height / before.height;
  const sane = (scale: number) => Number.isFinite(scale) && scale > 1 / MAX_SCALE && scale < MAX_SCALE;
  if (!sane(scaleX) || !sane(scaleY)) {
    return null;
  }
  return {
    scaleX,
    scaleY,
    translateX: after.x - before.x * scaleX,
    translateY: after.y - before.y * scaleY,
  };
}

/** Pixel box → fractions of the image. */
export function toFractions(box: Box, image: { width: number; height: number }): Box {
  return {
    x: box.x / image.width,
    y: box.y / image.height,
    width: box.width / image.width,
    height: box.height / image.height,
  };
}

/** The CSS transform for the original, with `transform-origin: 0 0`. */
export function alignmentToCss(alignment: CompareAlignment): string {
  const percent = (value: number) => `${(value * 100).toFixed(3)}%`;
  return `translate(${percent(alignment.translateX)}, ${percent(alignment.translateY)}) scale(${alignment.scaleX.toFixed(
    4,
  )}, ${alignment.scaleY.toFixed(4)})`;
}

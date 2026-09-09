import sharp from "sharp";

/**
 * Measures how far a generated floor plan drifts from the house style.
 *
 * The reference values below are measured from the six approved plans in
 * assets/style-references, not chosen by feel. Measuring them first also decided what this
 * checks: ink coverage ranges from 1.07% to 3.71% across those six, because it tracks how many
 * rooms a plan has rather than how it is drawn. Weighting it would flag a one-room apartment as
 * off-style. The palette is the part that actually holds still — the background is
 * rgb(224,212,200) in five of the six — so that carries most of the weight, and coverage
 * metrics only catch extremes.
 */

/** Measured across all six references. */
const HOUSE_BACKGROUND = { r: 224, g: 212, b: 200 };
const HOUSE_INK = { r: 0, g: 0, b: 0 };
const HOUSE_WHITE = { r: 255, g: 255, b: 255 };

/** Observed 1.07–3.71%. Widened, because this tracks plan complexity, not style. */
const INK_RATIO_RANGE: readonly [number, number] = [0.005, 0.06];

/** Observed 2.90–5.35%. Anti-aliasing along the lines; a hard-thresholded result falls below. */
const MID_RATIO_RANGE: readonly [number, number] = [0.015, 0.08];

/** Share of pixels close to none of the three house colours. The references sit far below. */
const OFF_PALETTE_CEILING = 0.02;

/**
 * The background is the sharpest signal in the house style, so it is judged tightly: the six
 * references sit within 4 units of each other, and a greyscale or tinted result lands at 17+.
 */
const BACKGROUND_TOLERANCE = 35;

/** Looser, because this only asks whether a pixel belongs to the palette at all. */
const PALETTE_TOLERANCE = 60;

/**
 * Below this there is no drawing to speak of. Treated as a hard failure rather than scored,
 * because a blank canvas is the right colour and would otherwise pass every other metric.
 */
const EMPTY_INK_FLOOR = 0.002;

/** How far past a limit counts as fully deviating, per metric. */
const OFF_PALETTE_SCALE = 0.15;

const WEIGHTS = {
  background: 0.45,
  offPalette: 0.3,
  mid: 0.15,
  ink: 0.1,
} as const;

/** Analysis width. Ratios are scale-invariant, so a small sample is both enough and fast. */
const SAMPLE_WIDTH = 400;

export type StyleMeasurement = {
  background: { r: number; g: number; b: number };
  inkRatio: number;
  whiteRatio: number;
  midRatio: number;
  offPaletteRatio: number;
};

export type StyleDeviation = {
  /** 0 means indistinguishable from the house style, 1 means nothing in common with it. */
  score: number;
  /** Swedish, one per failing metric. Written to be usable as a corrective instruction. */
  issues: string[];
  measurement: StyleMeasurement;
};

function distance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** How far outside [min, max] a value sits, as a fraction of the range's width. */
function rangeDeviation(value: number, [min, max]: readonly [number, number]) {
  if (value >= min && value <= max) {
    return 0;
  }

  const width = max - min;
  const overshoot = value < min ? min - value : value - max;
  return clamp01(overshoot / width);
}

export async function measureStyle(imageBuffer: Buffer): Promise<StyleMeasurement> {
  const { data, info } = await sharp(imageBuffer)
    .resize({ width: SAMPLE_WIDTH, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const pixels = info.width * info.height;

  let ink = 0;
  let white = 0;
  let mid = 0;
  let offPalette = 0;
  const backgroundCandidates = new Map<number, number>();

  for (let index = 0; index < pixels; index += 1) {
    const offset = index * channels;
    const pixel = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    const luminance = 0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b;

    if (luminance < 70) {
      ink += 1;
    } else if (luminance > 245) {
      white += 1;
    } else if (luminance < 200) {
      mid += 1;
    } else {
      // Quantised so compression noise does not split the background across buckets.
      const key = ((pixel.r >> 2) << 12) | ((pixel.g >> 2) << 6) | (pixel.b >> 2);
      backgroundCandidates.set(key, (backgroundCandidates.get(key) ?? 0) + 1);
    }

    const nearest = Math.min(
      distance(pixel, HOUSE_BACKGROUND),
      distance(pixel, HOUSE_INK),
      distance(pixel, HOUSE_WHITE),
    );
    if (nearest > PALETTE_TOLERANCE) {
      offPalette += 1;
    }
  }

  let dominantKey = -1;
  let dominantCount = 0;
  for (const [key, count] of backgroundCandidates) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantKey = key;
    }
  }

  const background =
    dominantKey < 0
      ? { r: 0, g: 0, b: 0 }
      : {
          r: ((dominantKey >> 12) & 63) << 2,
          g: ((dominantKey >> 6) & 63) << 2,
          b: (dominantKey & 63) << 2,
        };

  return {
    background,
    inkRatio: ink / pixels,
    whiteRatio: white / pixels,
    midRatio: mid / pixels,
    offPaletteRatio: offPalette / pixels,
  };
}

export async function measureStyleDeviation(imageBuffer: Buffer): Promise<StyleDeviation> {
  const measurement = await measureStyle(imageBuffer);
  const issues: string[] = [];

  if (measurement.inkRatio < EMPTY_INK_FLOOR) {
    return {
      score: 1,
      issues: [
        "Bilden är i praktiken tom. Rita hela planlösningen med väggar, dörrar, fönster och rumsnamn.",
      ],
      measurement,
    };
  }

  const backgroundDeviation = clamp01(
    distance(measurement.background, HOUSE_BACKGROUND) / BACKGROUND_TOLERANCE,
  );
  if (backgroundDeviation > 0.35) {
    issues.push(
      `Bakgrunden blev rgb(${measurement.background.r}, ${measurement.background.g}, ${measurement.background.b}). Den ska vara exakt #E1D5C9 över hela bilden, både utanför planlösningen och inuti varje rum.`,
    );
  }

  const offPaletteDeviation = clamp01(
    Math.max(0, measurement.offPaletteRatio - OFF_PALETTE_CEILING) / OFF_PALETTE_SCALE,
  );
  if (offPaletteDeviation > 0.2) {
    issues.push(
      "Bilden innehåller färger utanför paletten. Använd bara #E1D5C9 som bakgrund, #000000 för linjer och text, och #FFFFFF för fönster. Ingen gråskala, ingen skuggning och ingen gradient.",
    );
  }

  const midDeviation = rangeDeviation(measurement.midRatio, MID_RATIO_RANGE);
  if (midDeviation > 0.4) {
    issues.push(
      measurement.midRatio < MID_RATIO_RANGE[0]
        ? "Linjerna är hårt trappstegsformade. Rita dem med mjuka, jämna kanter."
        : "Linjerna är suddiga. Rita dem skarpa och med jämn tjocklek.",
    );
  }

  const inkDeviation = rangeDeviation(measurement.inkRatio, INK_RATIO_RANGE);
  if (inkDeviation > 0.4) {
    issues.push(
      measurement.inkRatio < INK_RATIO_RANGE[0]
        ? "Ritningen är nästan tom. Rita hela planlösningen med väggar, dörrar, fönster och rumsnamn."
        : "Ritningen är för mörk. Väggarna ska vara jämntjocka linjer, inte stora fyllda ytor.",
    );
  }

  const score =
    WEIGHTS.background * backgroundDeviation +
    WEIGHTS.offPalette * offPaletteDeviation +
    WEIGHTS.mid * midDeviation +
    WEIGHTS.ink * inkDeviation;

  return { score, issues, measurement };
}

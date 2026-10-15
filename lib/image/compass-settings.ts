/**
 * What the broker decides about the sheet's compass: whether it is there, and where north
 * points (degrees clockwise from the top of the sheet). Shared by the browser controls and the
 * routes, so both read the same rules.
 */
export type CompassSettings = {
  visible: boolean;
  rotation: number;
};

/** Turns any angle into 0 <= angle < 360, at a tenth of a degree. */
export function normaliseRotation(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  const rounded = Math.round(wrapped * 10) / 10;
  return rounded >= 360 ? 0 : rounded;
}

/**
 * The compass a plan starts with: always north-up. A scan shows it, anything else (photos,
 * scans without a heading) starts hidden. The scan's own direction is no longer pre-selected.
 */
export function defaultCompass(scanRotation: number | null): CompassSettings {
  return { visible: scanRotation !== null, rotation: 0 };
}

/**
 * The eight directions the broker picks from. `rotation` is where NORTH points on the sheet,
 * degrees clockwise from the top (so "O", east, turns the badge's N to the right).
 */
export const COMPASS_DIRECTIONS = [
  { key: "N", name: "Norr", rotation: 0 },
  { key: "NO", name: "Nordost", rotation: 45 },
  { key: "O", name: "Ost", rotation: 90 },
  { key: "SO", name: "Sydost", rotation: 135 },
  { key: "S", name: "Syd", rotation: 180 },
  { key: "SV", name: "Sydväst", rotation: 225 },
  { key: "V", name: "Väst", rotation: 270 },
  { key: "NV", name: "Nordväst", rotation: 315 },
] as const;

/** The direction closest to any angle (a stored plan may hold something between the eight). */
export function nearestCompassDirection(degrees: number): (typeof COMPASS_DIRECTIONS)[number] {
  const index = Math.round(normaliseRotation(degrees) / 45) % 8;
  return COMPASS_DIRECTIONS[index];
}

/**
 * Reads a compass choice from untrusted input. Returns null when it is absent; a present but
 * malformed value also yields null, so the defaults apply rather than a guess.
 */
export function parseCompassSettings(value: unknown): CompassSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const { visible, rotation } = value as Record<string, unknown>;
  if (typeof visible !== "boolean") {
    return null;
  }
  const degrees = typeof rotation === "number" ? rotation : typeof rotation === "string" ? Number(rotation) : NaN;
  if (!Number.isFinite(degrees) || Math.abs(degrees) > 1_000_000) {
    return null;
  }
  return { visible, rotation: normaliseRotation(degrees) };
}

/** Form-field flavour for /api/convert: `compassVisible` ("1"/"0") and `compassRotation`. */
export function parseCompassFormFields(
  visible: FormDataEntryValue | null,
  rotation: FormDataEntryValue | null,
): CompassSettings | null {
  if (visible !== "1" && visible !== "0") {
    return null;
  }
  return parseCompassSettings({
    visible: visible === "1",
    rotation: typeof rotation === "string" && rotation.trim() !== "" ? rotation : 0,
  });
}

/** What the sheet is composed with: the angle to draw, or null for no compass. */
export function compassRotationToDraw(settings: CompassSettings): number | null {
  return settings.visible ? settings.rotation : null;
}

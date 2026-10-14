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
 * The compass a plan starts with: a scan with a known direction shows it, anything else
 * (photos, scans without a heading) hides it and starts at north-up.
 */
export function defaultCompass(scanRotation: number | null): CompassSettings {
  return scanRotation === null
    ? { visible: false, rotation: 0 }
    : { visible: true, rotation: normaliseRotation(scanRotation) };
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

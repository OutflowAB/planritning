/**
 * How long conversions have taken on this device, so the processing screen can say what to
 * expect instead of leaving people to guess. Kept in localStorage: a per-device convenience,
 * and everything here copes with storage being unavailable.
 */

const STORAGE_KEY = "conversion-durations-v1";
const KEEP = 8;
/** Shorter than this is not a real conversion (a cancelled or cached one); longer is a stall. */
const MIN_MS = 5_000;
const MAX_MS = 10 * 60_000;

function read(): number[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
  } catch {
    return [];
  }
}

export function recordConversionDuration(ms: number) {
  if (!(ms >= MIN_MS && ms <= MAX_MS)) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...read(), Math.round(ms)].slice(-KEEP)));
  } catch {
    // Private mode or full storage: the estimate is a nicety, not worth an error.
  }
}

/** The median of recent conversions, or null before there is anything to go on. */
export function expectedConversionMs(): number | null {
  const durations = read().sort((a, b) => a - b);
  if (durations.length === 0) {
    return null;
  }
  const middle = Math.floor(durations.length / 2);
  return durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2;
}

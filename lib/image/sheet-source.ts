import type { SupabaseClient } from "@supabase/supabase-js";

import type { Rgb } from "@/lib/image/brand-floorplan";
import { parseCompassSettings, type CompassSettings } from "@/lib/image/compass-settings";
import { BUCKET_NAME } from "@/lib/supabase-server";

/**
 * What it takes to compose a generated sheet again without drawing it again: the drawing as
 * it came out of the model (no frame, heading, logo or compass) and a small JSON next to it
 * with the settings it was composed with. Both live in storage under raw/, named after the
 * generated file, so no database column is involved. Plans generated before this existed
 * have neither and simply cannot be re-composed.
 */
export const RAW_PREFIX = "raw/";

export type SheetMeta = {
  version: 1;
  /** Whether the drawing is AI line art (tones preserved) or a processed photo. */
  engine: "ai" | "algorithm";
  sourceKind: "scan" | "photo";
  background: Rgb | null;
  /** The scan's own direction, so "Återställ" has something to go back to. */
  scanRotation: number | null;
  compass: CompassSettings;
  /** Size of the composed sheet as stored. A different size on disk means it was edited since. */
  outputSize: number;
};

function baseName(generatedPath: string) {
  return generatedPath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "sheet";
}

export function rawImagePath(generatedPath: string) {
  return `${RAW_PREFIX}${baseName(generatedPath)}.png`;
}

export function rawMetaPath(generatedPath: string) {
  return `${RAW_PREFIX}${baseName(generatedPath)}.json`;
}

function parseRgb(value: unknown): Rgb | null {
  if (typeof value !== "object" || value === null) return null;
  const { r, g, b } = value as Record<string, unknown>;
  return [r, g, b].every((channel) => typeof channel === "number" && channel >= 0 && channel <= 255)
    ? { r: r as number, g: g as number, b: b as number }
    : null;
}

export function parseSheetMeta(text: string): SheetMeta | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const compass = parseCompassSettings(value.compass);
    if (
      value.version !== 1 ||
      (value.engine !== "ai" && value.engine !== "algorithm") ||
      (value.sourceKind !== "scan" && value.sourceKind !== "photo") ||
      !compass ||
      typeof value.outputSize !== "number"
    ) {
      return null;
    }
    return {
      version: 1,
      engine: value.engine,
      sourceKind: value.sourceKind,
      background: parseRgb(value.background),
      scanRotation: typeof value.scanRotation === "number" ? value.scanRotation : null,
      compass,
      outputSize: value.outputSize,
    };
  } catch {
    return null;
  }
}

/** Best effort: a failure here only costs the later chance to adjust the compass. */
export async function storeSheetSource(
  supabase: SupabaseClient,
  generatedPath: string,
  drawing: Buffer,
  meta: SheetMeta,
): Promise<boolean> {
  const bucket = supabase.storage.from(BUCKET_NAME);
  const image = await bucket.upload(rawImagePath(generatedPath), drawing, {
    contentType: "image/png",
    upsert: true,
  });
  if (image.error) {
    console.warn(`Could not store the raw drawing: ${image.error.message}`);
    return false;
  }
  return writeSheetMeta(supabase, generatedPath, meta);
}

export async function writeSheetMeta(supabase: SupabaseClient, generatedPath: string, meta: SheetMeta) {
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(rawMetaPath(generatedPath), Buffer.from(JSON.stringify(meta)), {
      contentType: "application/json",
      upsert: true,
    });
  if (error) {
    console.warn(`Could not store the sheet settings: ${error.message}`);
    return false;
  }
  return true;
}

export async function readSheetMeta(supabase: SupabaseClient, generatedPath: string) {
  const { data } = await supabase.storage.from(BUCKET_NAME).download(rawMetaPath(generatedPath));
  return data ? parseSheetMeta(await data.text()) : null;
}

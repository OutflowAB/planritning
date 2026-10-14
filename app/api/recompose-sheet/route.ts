import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { composeBrandedFloorplan } from "@/lib/image/brand-floorplan";
import {
  compassRotationToDraw,
  defaultCompass,
  parseCompassSettings,
} from "@/lib/image/compass-settings";
import { rawImagePath, readSheetMeta, writeSheetMeta, type SheetMeta } from "@/lib/image/sheet-source";
import { createThumbnail, thumbnailPath } from "@/lib/image/thumbnail";
import { imageUrl } from "@/lib/image-url";
import { requireRole } from "@/lib/server-auth";
import {
  BUCKET_NAME,
  GENERATED_PREFIX,
  getAdminSupabase,
  normaliseEtag,
  serverConfigMissingResponse,
  UPLOADS_TABLE,
} from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * The compass of a stored sheet, and whether it can be changed: GET reads it, POST composes
 * the sheet again with new settings. Nothing here talks to the image model: the raw drawing
 * kept next to the sheet (see sheet-source.ts) is composed again, which costs milliseconds and
 * no credit. The stored sheet is replaced in place, as the editor's publish does, with a new
 * thumbnail and a new version so the browser fetches the new picture.
 */

function reply(message: string, status: number, code?: string) {
  return NextResponse.json({ message, ...(code ? { code } : {}) }, { status });
}

const NOT_ADJUSTABLE = "Kompassen kan inte ändras för den här planen. Den skapades innan originalunderlaget sparades.";
const EDITED = "Planen har redigerats i verktyget, så kompassen kan inte ändras utan att redigeringarna går förlorade.";

type FoundSheet =
  | { error: Response }
  | { error?: undefined; supabase: SupabaseClient; row: { id: number; file_path: string; file_size: number } };

async function findSheet(imageId: unknown): Promise<FoundSheet> {
  const id = typeof imageId === "string" ? Number(imageId) : imageId;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return { error: reply("Ogiltig bildreferens.", 400) };
  }

  const supabase = getAdminSupabase();
  if (!supabase) {
    return { error: serverConfigMissingResponse() };
  }

  const { data: row } = await supabase
    .from(UPLOADS_TABLE)
    .select("id, file_path, file_size")
    .eq("id", id)
    .maybeSingle();
  if (!row || typeof row.file_path !== "string" || !row.file_path.startsWith(GENERATED_PREFIX)) {
    return { error: reply("Den valda bilden hittades inte.", 404) };
  }

  return { supabase, row: row as { id: number; file_path: string; file_size: number } };
}

function describe(meta: SheetMeta) {
  return {
    ...meta.compass,
    scanRotation: meta.scanRotation,
    sourceKind: meta.sourceKind,
    adjustable: true as const,
  };
}

export async function GET(request: Request): Promise<Response> {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  const found = await findSheet(new URL(request.url).searchParams.get("imageId"));
  if (found.error) {
    return found.error;
  }

  const meta = await readSheetMeta(found.supabase, found.row.file_path);
  if (!meta) {
    return NextResponse.json(
      { adjustable: false, reason: NOT_ADJUSTABLE, ...defaultCompass(null), scanRotation: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (meta.outputSize !== found.row.file_size) {
    return NextResponse.json(
      { ...describe(meta), adjustable: false, reason: EDITED },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(describe(meta), { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/recompose-sheet  { imageId, compass: { visible, rotation } } */
export async function POST(request: Request): Promise<Response> {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return reply("Ogiltig förfrågan.", 400);
  }

  const compass = parseCompassSettings(body.compass);
  if (!compass) {
    return reply("Ogiltiga kompassinställningar.", 400);
  }

  const found = await findSheet(body.imageId);
  if (found.error) {
    return found.error;
  }
  const { supabase, row } = found;

  const meta = await readSheetMeta(supabase, row.file_path);
  const bucket = supabase.storage.from(BUCKET_NAME);
  const raw = meta ? await bucket.download(rawImagePath(row.file_path)) : null;
  if (!meta || !raw?.data) {
    return reply(NOT_ADJUSTABLE, 409, "not-adjustable");
  }
  if (meta.outputSize !== row.file_size) {
    return reply(EDITED, 409, "edited");
  }

  const composed = await composeBrandedFloorplan(Buffer.from(await raw.data.arrayBuffer()), {
    preserveTones: meta.engine === "ai",
    compassRotationDegrees: compassRotationToDraw(compass),
    ...(meta.engine === "ai" && meta.background ? { backgroundColor: meta.background } : {}),
  });

  const { error: uploadError } = await bucket.upload(row.file_path, composed.output, {
    upsert: true,
    contentType: "image/png",
  });
  if (uploadError) {
    console.error("Failed to store the re-composed sheet", uploadError);
    return reply("Kunde inte spara planritningen.", 500);
  }

  const { error: rowError } = await supabase
    .from(UPLOADS_TABLE)
    .update({ file_size: composed.output.byteLength })
    .eq("id", row.id);
  if (rowError) {
    console.error("Failed to update the re-composed sheet's row", rowError);
    return reply("Kunde inte uppdatera bildens metadata.", 500);
  }

  const next: SheetMeta = { ...meta, compass, outputSize: composed.output.byteLength };
  await writeSheetMeta(supabase, row.file_path, next);

  // A fresh version for the image URL, and the thumbnail that goes with it.
  let version: string | null = null;
  try {
    const name = row.file_path.slice(GENERATED_PREFIX.length);
    const { data: listed } = await bucket.list(GENERATED_PREFIX.replace(/\/$/, ""), { search: name, limit: 1 });
    version = normaliseEtag((listed?.[0]?.metadata as { eTag?: unknown } | null)?.eTag);
    await bucket.upload(
      thumbnailPath(row.file_path, version ?? String(composed.output.byteLength)),
      await createThumbnail(composed.output),
      { contentType: "image/webp", upsert: true },
    );
  } catch (error) {
    console.error("Thumbnail generation failed after re-composing", error);
  }

  return NextResponse.json(
    {
      ...describe(next),
      savedImageUrl: imageUrl(row.id, "full", version ?? String(composed.output.byteLength)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

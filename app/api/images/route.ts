import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { draftVersion } from "@/lib/floorplan/preview";
import { readPlanMeta } from "@/lib/plan-meta";
import { requireRole } from "@/lib/server-auth";
import {
  BLANK_FLOORPLAN_PREFIX,
  BUCKET_NAME,
  DOCUMENTS_TABLE,
  GENERATED_PREFIX,
  getAdminSupabase,
  listStorageVersions,
  normaliseEtag,
  serverConfigMissingResponse,
  UPLOADED_IMAGE_COLUMNS,
  UPLOADS_PREFIX,
  UPLOADS_TABLE,
  type UploadedImageRow,
} from "@/lib/supabase-server";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export type ImageListItem = UploadedImageRow & {
  /** Storage eTag. Goes into the image URL so the browser can cache it as immutable. */
  version: string | null;
  /** The name someone gave it, usually an address. Null when unnamed or not yet migrated. */
  label: string | null;
  /** The floor of a scanned plan ("ENTRÉPLAN"). Null when not set or not yet migrated. */
  floor_label: string | null;
};

/** When each blank or scanned plan among `rows` was last saved, by id. */
async function draftSaves(supabase: SupabaseClient, rows: UploadedImageRow[]): Promise<Map<number, string>> {
  const ids = rows.filter((row) => row.file_path.startsWith(BLANK_FLOORPLAN_PREFIX)).map((row) => row.id);
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from(DOCUMENTS_TABLE).select("image_id, updated_at").in("image_id", ids);
  return new Map((data ?? []).map((saved) => [saved.image_id as number, saved.updated_at as string]));
}

/**
 * A blank or scanned plan's page never changes until it is finished, but the plan on it does, so
 * its picture's version follows its last save. Other images keep their storage version.
 */
function versionOf(row: UploadedImageRow, pageVersion: string | null, saves: Map<number, string>): string | null {
  const saved = saves.get(row.id);
  return saved ? draftVersion(pageVersion, saved) : pageVersion;
}

function parseIsoDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * GET /api/images?kind=uploads|generated|scans[&saved=1][&from=ISO&to=ISO][&limit=N][&count=1]
 *
 * `scans` are the plans started from a LiDAR scan or a blank page (a subset of `generated`).
 *
 * The only way the browser reads the image tables. The pages used to query Supabase directly
 * with the public key, which meant the public key had to be allowed to read everything.
 */
export async function GET(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  const supabase = getAdminSupabase();
  if (!supabase) {
    return serverConfigMissingResponse();
  }

  const { searchParams } = new URL(request.url);

  // Single row, any prefix. Used to resolve a handed-over upload or restore a review, where
  // "does this still exist" is the question — a deleted image must come back as 404, not as
  // a URL that fails later in an <img>.
  const singleId = Number(searchParams.get("id"));
  if (Number.isInteger(singleId) && singleId > 0) {
    const { data: row, error } = await supabase
      .from(UPLOADS_TABLE)
      .select(UPLOADED_IMAGE_COLUMNS)
      .eq("id", singleId)
      .maybeSingle();
    if (error || !row) {
      return NextResponse.json({ message: "Bilden finns inte längre." }, { status: 404 });
    }
    const typed = row as unknown as UploadedImageRow;
    const folder = typed.file_path.split("/")[0];
    const { data: listed } = await supabase.storage
      .from(BUCKET_NAME)
      .list(folder, { search: typed.file_path.slice(folder.length + 1), limit: 1 });
    const version = normaliseEtag((listed?.[0]?.metadata as { eTag?: unknown } | null)?.eTag);
    const meta = (await readPlanMeta(supabase, [typed.id])).get(typed.id);
    const item: ImageListItem = {
      ...typed,
      version: versionOf(typed, version, await draftSaves(supabase, [typed])),
      label: meta?.address ?? null,
      floor_label: meta?.floorLabel ?? null,
    };
    return NextResponse.json({ item }, { headers: { "Cache-Control": "no-store" } });
  }

  const kind = searchParams.get("kind");
  if (kind !== "uploads" && kind !== "generated" && kind !== "scans") {
    return NextResponse.json({ message: "Ogiltig listtyp." }, { status: 400 });
  }

  // Scans are stored among the generations; the folder is what storage can list.
  const folder = kind === "uploads" ? UPLOADS_PREFIX : GENERATED_PREFIX;
  const prefix = kind === "scans" ? BLANK_FLOORPLAN_PREFIX : folder;
  const savedOnly = searchParams.get("saved") === "1";
  const from = parseIsoDate(searchParams.get("from"));
  const to = parseIsoDate(searchParams.get("to"));
  const countOnly = searchParams.get("count") === "1";
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(searchParams.get("limit")) || DEFAULT_LIMIT),
  );

  // The same filters are applied to whichever shape of query the request needs. Supabase's
  // typed query builder cannot express "select these columns, or count" in one expression.
  type Filterable<Q> = {
    like(column: string, pattern: string): Q;
    not(column: string, operator: string, value: null): Q;
    gte(column: string, value: string): Q;
    lt(column: string, value: string): Q;
  };
  const applyFilters = <Q extends Filterable<Q>>(query: Q): Q => {
    let filtered = query.like("file_path", `${prefix}%`);
    if (savedOnly) filtered = filtered.not("saved_at", "is", null);
    if (from) filtered = filtered.gte("created_at", from);
    if (to) filtered = filtered.lt("created_at", to);
    return filtered;
  };

  if (countOnly) {
    const { count, error } = await applyFilters(
      supabase.from(UPLOADS_TABLE).select("id", { count: "exact", head: true }),
    );
    if (error) {
      console.error("Failed to count images", error);
      return NextResponse.json({ message: "Kunde inte räkna bilder." }, { status: 500 });
    }
    return NextResponse.json({ count: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  }

  // Rows and storage versions are independent, so fetch them at the same time.
  const [rowsResult, versions] = await Promise.all([
    applyFilters(supabase.from(UPLOADS_TABLE).select(UPLOADED_IMAGE_COLUMNS))
      .order("created_at", { ascending: false })
      .limit(limit),
    listStorageVersions(supabase, folder),
  ]);

  if (rowsResult.error) {
    console.error("Failed to list images", rowsResult.error);
    return NextResponse.json({ message: "Kunde inte hämta bilder." }, { status: 500 });
  }

  const rows = (rowsResult.data ?? []) as unknown as UploadedImageRow[];
  const metas = await readPlanMeta(
    supabase,
    rows.map((row) => row.id),
  );
  const saves = await draftSaves(supabase, rows);
  const items: ImageListItem[] = rows.map((row) => ({
    ...row,
    version: versionOf(row, versions.get(row.file_path) ?? null, saves),
    label: metas.get(row.id)?.address ?? null,
    floor_label: metas.get(row.id)?.floorLabel ?? null,
  }));

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

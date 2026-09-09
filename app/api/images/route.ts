import { NextResponse } from "next/server";

import { requireRole } from "@/lib/server-auth";
import {
  BUCKET_NAME,
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
};

function parseIsoDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * GET /api/images?kind=uploads|generated[&saved=1][&from=ISO&to=ISO][&limit=N][&count=1]
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
    const item: ImageListItem = { ...typed, version };
    return NextResponse.json({ item }, { headers: { "Cache-Control": "no-store" } });
  }

  const kind = searchParams.get("kind");
  if (kind !== "uploads" && kind !== "generated") {
    return NextResponse.json({ message: "Ogiltig listtyp." }, { status: 400 });
  }

  const prefix = kind === "uploads" ? UPLOADS_PREFIX : GENERATED_PREFIX;
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
    listStorageVersions(supabase, prefix),
  ]);

  if (rowsResult.error) {
    console.error("Failed to list images", rowsResult.error);
    return NextResponse.json({ message: "Kunde inte hämta bilder." }, { status: 500 });
  }

  const rows = (rowsResult.data ?? []) as unknown as UploadedImageRow[];
  const items: ImageListItem[] = rows.map((row) => ({
    ...row,
    version: versions.get(row.file_path) ?? null,
  }));

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

import { NextResponse } from "next/server";

import { loadOwnedImage } from "@/lib/ownership";
import { requireSession } from "@/lib/server-auth";
import {
  BLANK_FLOORPLAN_PREFIX,
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
  /** Only the owner edits and finishes a plan; a superadmin may look at and delete it. */
  can_edit: boolean;
};

function parseIsoDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * GET /api/images?kind=uploads|generated[&saved=1][&q=address][&from=ISO&to=ISO][&limit=N]
 *   [&offset=N][&count=1]
 *
 * The only way the browser reads the image tables. The pages used to query Supabase directly
 * with the public key, which meant the public key had to be allowed to read everything.
 */
export async function GET(request: Request) {
  const session = await requireSession();
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
    const owned = await loadOwnedImage(supabase, session, singleId);
    if (!owned.ok) {
      return owned.response;
    }
    const typed = owned.row;
    const folder = typed.file_path.split("/")[0];
    const { data: listed } = await supabase.storage
      .from(BUCKET_NAME)
      .list(folder, { search: typed.file_path.slice(folder.length + 1), limit: 1 });
    const version = normaliseEtag((listed?.[0]?.metadata as { eTag?: unknown } | null)?.eTag);
    const item: ImageListItem = {
      ...typed,
      version: typed.published_at ?? version,
      can_edit: typed.owner_id === session.userId,
    };
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
  const offset = Math.max(0, Math.trunc(Number(searchParams.get("offset")) || 0));
  // Search by address, or by number for plans without one ("Bild 12").
  const search = (searchParams.get("q") ?? "").trim().slice(0, 100);
  const searchId = /^(bild\s*)?\d+$/i.test(search) ? Number(search.replace(/\D/g, "")) : null;
  const searchPattern = `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  // Which plans: finished (published=1) or still in progress (published=0); drawn from a scan
  // or blank page (source=blank) or redrawn by the AI (source=ai).
  const published = searchParams.get("published");
  // scope=plans: what Planritningar lists, every plan that is finished or is an approved AI
  // conversion (scans and blank plans appear once finished; until then they are under Skannare).
  const plansScope = searchParams.get("scope") === "plans";
  const PLANS_SCOPE = `published_at.not.is.null,file_path.not.like.${BLANK_FLOORPLAN_PREFIX}*`;
  const source = searchParams.get("source");

  // The same filters are applied to whichever shape of query the request needs. Supabase's
  // typed query builder cannot express "select these columns, or count" in one expression.
  type Filterable<Q> = {
    like(column: string, pattern: string): Q;
    not(column: string, operator: string, value: string | null): Q;
    gte(column: string, value: string): Q;
    lt(column: string, value: string): Q;
  };
  const applyFilters = <Q extends Filterable<Q>>(query: Q): Q => {
    let filtered = query.like("file_path", `${prefix}%`);
    if (savedOnly) filtered = filtered.not("saved_at", "is", null);
    // Unsaved generated lists are the AI generations (counts, billing). Blank plans are not
    // generations; they only show up once saved, in the library.
    else if (kind === "generated") filtered = filtered.not("file_path", "like", `${BLANK_FLOORPLAN_PREFIX}%`);
    if (from) filtered = filtered.gte("created_at", from);
    if (to) filtered = filtered.lt("created_at", to);
    return filtered;
  };

  // A realtor sees their own images; a superadmin sees everyone's.
  const ownerFilter = session.isAdmin ? null : session.userId;

  if (countOnly) {
    let countQuery = supabase.from(UPLOADS_TABLE).select("id", { count: "exact", head: true });
    if (ownerFilter) countQuery = countQuery.eq("owner_id", ownerFilter);
    if (plansScope) countQuery = countQuery.or(PLANS_SCOPE);
    if (published === "1") countQuery = countQuery.not("published_at", "is", null);
    if (published === "0") countQuery = countQuery.is("published_at", null);
    if (source === "blank") countQuery = countQuery.like("file_path", `${BLANK_FLOORPLAN_PREFIX}%`);
    if (source === "ai") countQuery = countQuery.not("file_path", "like", `${BLANK_FLOORPLAN_PREFIX}%`);
    if (searchId !== null) countQuery = countQuery.eq("id", searchId);
    else if (search) countQuery = countQuery.ilike("address", searchPattern);
    const { count, error } = await applyFilters(countQuery);
    if (error) {
      console.error("Failed to count images", error);
      return NextResponse.json({ message: "Kunde inte räkna bilder." }, { status: 500 });
    }
    return NextResponse.json({ count: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  }

  // Rows and storage versions are independent, so fetch them at the same time.
  let listQuery = supabase.from(UPLOADS_TABLE).select(UPLOADED_IMAGE_COLUMNS);
  if (ownerFilter) listQuery = listQuery.eq("owner_id", ownerFilter);
  if (plansScope) listQuery = listQuery.or(PLANS_SCOPE);
  if (published === "1") listQuery = listQuery.not("published_at", "is", null);
  if (published === "0") listQuery = listQuery.is("published_at", null);
  if (source === "blank") listQuery = listQuery.like("file_path", `${BLANK_FLOORPLAN_PREFIX}%`);
  if (source === "ai") listQuery = listQuery.not("file_path", "like", `${BLANK_FLOORPLAN_PREFIX}%`);
  if (searchId !== null) listQuery = listQuery.eq("id", searchId);
  else if (search) listQuery = listQuery.ilike("address", searchPattern);
  const [rowsResult, versions] = await Promise.all([
    applyFilters(listQuery)
      // Newest first: by when a plan was saved, which a finish also moves.
      .order(kind === "uploads" ? "created_at" : "saved_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1),
    listStorageVersions(supabase, prefix),
  ]);

  if (rowsResult.error) {
    console.error("Failed to list images", rowsResult.error);
    return NextResponse.json({ message: "Kunde inte hämta bilder." }, { status: 500 });
  }

  const rows = (rowsResult.data ?? []) as unknown as UploadedImageRow[];
  const items: ImageListItem[] = rows.map((row) => ({
    ...row,
    // A finished plan changes when it is finished again; its original never changes.
    version: row.published_at ?? versions.get(row.file_path) ?? null,
    can_edit: row.owner_id === session.userId,
  }));

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

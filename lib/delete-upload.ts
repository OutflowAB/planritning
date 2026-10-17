import type { SupabaseClient } from "@supabase/supabase-js";

import { loadOwnedImage } from "@/lib/ownership";
import type { Session } from "@/lib/server-auth";
import { BUCKET_NAME, THUMBNAILS_PREFIX, UPLOADS_TABLE } from "@/lib/supabase-server";

export type DeleteUploadResult =
  | { ok: true; deletedId: number }
  | { ok: false; status: number; message: string };

type PathRow = { file_path: string; published_path: string | null };

/**
 * Thumbnails are derivatives keyed by the source name plus a version tag, so they are found by
 * prefix rather than by an exact path.
 */
export async function thumbnailPathsFor(supabase: SupabaseClient, sourcePaths: string[]) {
  const found: string[] = [];
  for (const sourcePath of sourcePaths) {
    const baseName = sourcePath.split("/").pop()?.replace(/\.[^.]+$/, "");
    if (!baseName) continue;
    const { data: thumbs } = await supabase.storage
      .from(BUCKET_NAME)
      .list(THUMBNAILS_PREFIX.replace(/\/$/, ""), { search: baseName, limit: 100 });
    for (const thumb of thumbs ?? []) {
      if (thumb.name.startsWith(`${baseName}-`)) {
        found.push(`${THUMBNAILS_PREFIX}${thumb.name}`);
      }
    }
  }
  return found;
}

/**
 * Deletes an image the user may delete (their own; a superadmin's: anyone's), the plans made
 * from it, and every file of theirs. Deleting the last plan made from an original deletes the
 * original too. Only paths stored in the database are removed, never a path the client names.
 * Reviews and documents go with their rows (foreign keys cascade).
 */
export async function deleteUploadRecord(
  supabase: SupabaseClient,
  owner: Pick<Session, "userId" | "isAdmin">,
  id: number,
): Promise<DeleteUploadResult> {
  const owned = await loadOwnedImage(supabase, owner, id);
  if (!owned.ok) {
    return { ok: false, status: 404, message: "Bilden hittades inte eller är redan borttagen." };
  }

  const { data: children, error: childrenError } = await supabase
    .from(UPLOADS_TABLE)
    .select("file_path, published_path")
    .eq("source_upload_id", id);
  if (childrenError) {
    return { ok: false, status: 500, message: "Kunde inte läsa kopplade planritningar." };
  }

  const rows: PathRow[] = [owned.row, ...((children as PathRow[] | null) ?? [])];
  const storagePaths = Array.from(
    new Set(rows.flatMap((row) => [row.file_path, row.published_path]).filter((path): path is string => Boolean(path))),
  );
  const thumbnailPaths = await thumbnailPathsFor(supabase, storagePaths);

  // Plans made from this image are removed with it (source_upload_id cascades).
  const { error: deleteError } = await supabase.from(UPLOADS_TABLE).delete().eq("id", id);
  if (deleteError) {
    return { ok: false, status: 500, message: "Kunde inte radera posten." };
  }

  // The last plan made from an original takes the original with it, so it does not linger under
  // Konverterare. While another plan still comes from it, the original stays.
  if (owned.row.source_upload_id) {
    const { count } = await supabase
      .from(UPLOADS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("source_upload_id", owned.row.source_upload_id);
    if (count === 0) {
      const original = await deleteUploadRecord(supabase, owner, owned.row.source_upload_id);
      if (!original.ok) console.error("Could not delete the original of a deleted plan", original.message);
    }
  }

  const { error: storageError } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([...storagePaths, ...thumbnailPaths]);
  if (storageError) {
    return { ok: false, status: 500, message: "Posten raderades men filen kunde inte tas bort." };
  }

  return { ok: true, deletedId: id };
}

import type { SupabaseClient } from "@supabase/supabase-js";

type ImageRow = {
  id: number;
  file_path: string;
};

export type DeleteUploadResult =
  | { ok: true; deletedId: number }
  | { ok: false; message: string };

export async function deleteUploadRecord(
  supabase: SupabaseClient,
  id: number,
  filePath: string,
): Promise<DeleteUploadResult> {
  const trimmedPath = filePath.trim();
  if (!Number.isFinite(id) || !trimmedPath) {
    return { ok: false, message: "Ogiltig förfrågan." };
  }

  const { data: cascadedRows, error: cascadedRowsError } = await supabase
    .from("uploaded_images")
    .select("id, file_path")
    .eq("source_upload_id", id)
    .like("file_path", "generated/%");

  if (cascadedRowsError) {
    return {
      ok: false,
      message: `Kunde inte läsa kopplade genereringar: ${cascadedRowsError.message}`,
    };
  }

  const childRows = (cascadedRows as ImageRow[] | null) ?? [];
  const relatedImageIds = Array.from(new Set([id, ...childRows.map((row) => row.id)]));
  const storagePaths = Array.from(
    new Set([trimmedPath, ...childRows.map((row) => row.file_path).filter(Boolean)]),
  );

  const { error: reviewsError } = await supabase
    .from("generation_reviews")
    .delete()
    .in("image_id", relatedImageIds);

  if (reviewsError) {
    return {
      ok: false,
      message: `Kunde inte radera granskningar: ${reviewsError.message}`,
    };
  }

  const { error: documentsError } = await supabase
    .from("floor_plan_documents")
    .delete()
    .in("image_id", relatedImageIds);

  if (documentsError) {
    return {
      ok: false,
      message: `Kunde inte radera dokument: ${documentsError.message}`,
    };
  }

  if (childRows.length > 0) {
    const { error: childrenDeleteError } = await supabase
      .from("uploaded_images")
      .delete()
      .eq("source_upload_id", id);

    if (childrenDeleteError) {
      return {
        ok: false,
        message: `Kunde inte radera kopplade genereringar: ${childrenDeleteError.message}`,
      };
    }
  }

  let { data: deletedRows, error: deleteError } = await supabase
    .from("uploaded_images")
    .delete()
    .eq("id", id)
    .eq("file_path", trimmedPath)
    .select("id");

  if (deleteError) {
    return { ok: false, message: `Kunde inte radera post: ${deleteError.message}` };
  }

  if (!deletedRows || deletedRows.length === 0) {
    const fallback = await supabase.from("uploaded_images").delete().eq("id", id).select("id");
    deletedRows = fallback.data;
    deleteError = fallback.error;

    if (deleteError) {
      return { ok: false, message: `Kunde inte radera post: ${deleteError.message}` };
    }
  }

  if (!deletedRows || deletedRows.length === 0) {
    return { ok: false, message: "Bilden hittades inte eller är redan borttagen." };
  }

  // Thumbnails are derivatives keyed by the source name plus a version tag, so they are found
  // by prefix rather than by an exact path.
  const thumbnailPaths: string[] = [];
  for (const sourcePath of storagePaths) {
    const baseName = sourcePath.split("/").pop()?.replace(/\.[^.]+$/, "");
    if (!baseName) continue;
    const { data: thumbs } = await supabase.storage
      .from("planritningar")
      .list("thumbs", { search: baseName, limit: 100 });
    for (const thumb of thumbs ?? []) {
      if (thumb.name.startsWith(`${baseName}-`)) {
        thumbnailPaths.push(`thumbs/${thumb.name}`);
      }
    }
  }

  const { error: storageError } = await supabase.storage
    .from("planritningar")
    .remove([...storagePaths, ...thumbnailPaths]);
  if (storageError) {
    return {
      ok: false,
      message: `Posten raderades men filen kunde inte tas bort: ${storageError.message}`,
    };
  }

  return { ok: true, deletedId: id };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import type { Session } from "@/lib/server-auth";
import {
  GENERATED_PREFIX,
  REVIEWS_TABLE,
  UPLOADED_IMAGE_COLUMNS,
  UPLOADS_TABLE,
  type UploadedImageRow,
} from "@/lib/supabase-server";

type Owner = Pick<Session, "userId" | "isAdmin">;
type Filterable<Q> = { eq(column: string, value: unknown): Q };

/**
 * Limits a query on uploaded_images to the user's own rows. A superadmin may look at and
 * delete everyone's plans, but changes (`forChange`) are the owner's alone: an edit or a
 * finish is billed to whoever makes it.
 */
export function scopeToOwner<Q extends Filterable<Q>>(query: Q, owner: Owner, { forChange = false } = {}): Q {
  return owner.isAdmin && !forChange ? query : query.eq("owner_id", owner.userId);
}

export const NOT_FOUND_MESSAGE = "Bilden finns inte längre.";

export function notFound(message = NOT_FOUND_MESSAGE) {
  return NextResponse.json({ message }, { status: 404 });
}

/**
 * One image row the user may use. Someone else's image answers exactly like a missing one,
 * so ids cannot be probed.
 */
export async function loadOwnedImage(
  supabase: SupabaseClient,
  owner: Owner,
  id: number,
  options: { filePath?: string; prefix?: string; forChange?: boolean } = {},
): Promise<{ ok: true; row: UploadedImageRow } | { ok: false; response: NextResponse }> {
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, response: NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 }) };
  }

  let query = supabase.from(UPLOADS_TABLE).select(UPLOADED_IMAGE_COLUMNS).eq("id", id);
  if (options.filePath) query = query.eq("file_path", options.filePath);
  if (options.prefix) query = query.like("file_path", `${options.prefix}%`);
  query = scopeToOwner(query, owner, { forChange: options.forChange });

  const { data, error } = await query.maybeSingle<UploadedImageRow>();
  if (error || !data) {
    return { ok: false, response: notFound() };
  }
  return { ok: true, row: data };
}

/**
 * A finished-or-in-progress plan the user may open: a generated image that has been approved,
 * found by id or by path. Reading is open to a superadmin; changes (`forChange`) only to the
 * owner.
 */
export async function loadApprovedPlan(
  supabase: SupabaseClient,
  owner: Owner,
  ref: { imageId?: number | null; imagePath?: string | null },
  { forChange = false } = {},
): Promise<{ ok: true; row: UploadedImageRow } | { ok: false; response: NextResponse }> {
  let query = supabase.from(UPLOADS_TABLE).select(UPLOADED_IMAGE_COLUMNS).like("file_path", `${GENERATED_PREFIX}%`);

  if (ref.imageId !== undefined && ref.imageId !== null) {
    if (!Number.isInteger(ref.imageId) || ref.imageId <= 0) {
      return { ok: false, response: NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 }) };
    }
    query = query.eq("id", ref.imageId);
  }
  if (ref.imagePath) {
    if (!ref.imagePath.startsWith(GENERATED_PREFIX)) {
      return { ok: false, response: NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 }) };
    }
    query = query.eq("file_path", ref.imagePath);
  }
  if (!ref.imageId && !ref.imagePath) {
    return { ok: false, response: NextResponse.json({ message: "Ingen bild vald." }, { status: 400 }) };
  }

  const { data: row, error } = await scopeToOwner(query, owner, { forChange }).maybeSingle<UploadedImageRow>();
  if (error || !row) {
    return { ok: false, response: notFound("Den valda bilden hittades inte.") };
  }

  const { data: review } = await supabase
    .from(REVIEWS_TABLE)
    .select("id")
    .eq("image_id", row.id)
    .eq("decision", "approved")
    .limit(1)
    .maybeSingle();
  if (!review) {
    return { ok: false, response: NextResponse.json({ message: "Bilden är inte godkänd ännu." }, { status: 403 }) };
  }

  return { ok: true, row };
}

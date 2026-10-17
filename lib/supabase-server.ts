import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * The one server-side Supabase client. Every API route used to carry its own copy of this
 * function; several of them then reached for the anon key instead, which made the routes
 * subject to whatever the public key was allowed to do rather than to their own auth check.
 *
 * The service role bypasses row-level security, so nothing here may run before `requireSession`,
 * and every query on a user's data goes through `lib/ownership.ts`.
 */

export const BUCKET_NAME = "planritningar";
export const UPLOADS_TABLE = "uploaded_images";
export const REVIEWS_TABLE = "generation_reviews";
export const DOCUMENTS_TABLE = "floor_plan_documents";
export const GENERATION_EVENTS_TABLE = "generation_events";
export const BILLING_EVENTS_TABLE = "billing_events";

export const UPLOADS_PREFIX = "uploads/";
export const GENERATED_PREFIX = "generated/";
export { BLANK_FLOORPLAN_PREFIX } from "@/lib/floorplan/image-url";
export const THUMBNAILS_PREFIX = "thumbs/";
/** Finished plans, one file per plan, beside the untouched original. */
export const PUBLISHED_PREFIX = "published/";

let cachedClient: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient | null {
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}

export function serverConfigMissingResponse() {
  return NextResponse.json({ message: "Serverkonfiguration saknas." }, { status: 500 });
}

export type UploadedImageRow = {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string | null;
  created_at: string;
  saved_at: string | null;
  source_upload_id: number | null;
  owner_id: string;
  address: string | null;
  floor_label: string | null;
  published_path: string | null;
  published_at: string | null;
  purged_at: string | null;
  engine: string | null;
};

export const UPLOADED_IMAGE_COLUMNS =
  "id, file_name, file_path, file_size, mime_type, created_at, saved_at, source_upload_id, " +
  "owner_id, address, floor_label, published_path, published_at, purged_at, engine";

/** Strips the surrounding quotes Supabase includes in a storage object's eTag. */
export function normaliseEtag(etag: unknown): string | null {
  if (typeof etag !== "string" || etag.length === 0) {
    return null;
  }
  return etag.replace(/^"+|"+$/g, "");
}

/**
 * eTag per object under a prefix, in as few calls as the API allows. This is what gives image
 * URLs a version, so the browser can cache them as immutable and still see a republished file.
 */
export async function listStorageVersions(
  supabase: SupabaseClient,
  prefix: string,
): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  const folder = prefix.replace(/\/$/, "");
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(folder, { limit: pageSize, offset });

    if (error || !data) {
      break;
    }

    for (const object of data) {
      const etag = normaliseEtag((object.metadata as { eTag?: unknown } | null)?.eTag);
      if (etag && object.name !== ".emptyFolderPlaceholder") {
        versions.set(`${folder}/${object.name}`, etag);
      }
    }

    if (data.length < pageSize) {
      break;
    }
  }

  return versions;
}

import { NextResponse } from "next/server";

import { imageUrl } from "@/lib/image-url";
import { loadApprovedPlan } from "@/lib/ownership";
import { requireSession } from "@/lib/server-auth";
import {
  BUCKET_NAME,
  GENERATED_PREFIX,
  getAdminSupabase,
  normaliseEtag,
  serverConfigMissingResponse,
} from "@/lib/supabase-server";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  const { searchParams } = new URL(request.url);
  const imageIdParam = searchParams.get("imageId") ?? searchParams.get("previewImageId");
  const imagePathParam = searchParams.get("imagePath") ?? searchParams.get("previewImagePath");

  if (!imageIdParam && !imagePathParam) {
    return NextResponse.json({ message: "Ingen bild vald." }, { status: 400 });
  }

  const plan = await loadApprovedPlan(adminSupabase, session, {
    imageId: imageIdParam ? Number(imageIdParam) : null,
    imagePath: imagePathParam,
  });
  if (!plan.ok) {
    return plan.response;
  }
  const imageRow = plan.row;

  // Versioned so the browser can cache it as immutable; a republished plan gets a new URL.
  const folder = GENERATED_PREFIX.replace(/\/$/, "");
  const { data: listed } = await adminSupabase.storage
    .from(BUCKET_NAME)
    .list(folder, { search: imageRow.file_path.slice(folder.length + 1), limit: 1 });
  const version = normaliseEtag((listed?.[0]?.metadata as { eTag?: unknown } | null)?.eTag);

  return NextResponse.json({
    image: {
      id: imageRow.id,
      file_name: imageRow.file_name,
      file_path: imageRow.file_path,
      created_at: imageRow.created_at,
      preview_url: imageUrl(imageRow.id, "full", imageRow.published_at ?? version),
      is_saved: Boolean(imageRow.saved_at),
      is_published: Boolean(imageRow.published_at),
      address: imageRow.address,
      floor_label: imageRow.floor_label,
      // Only the owner edits and finishes a plan; a superadmin may look at it.
      can_edit: imageRow.owner_id === session.userId,
    },
  });
}

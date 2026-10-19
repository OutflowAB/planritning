import { NextResponse } from "next/server";

import { IMAGE_LABEL_MAX_LENGTH, normaliseImageLabel } from "@/lib/image-label";
import { requireRole } from "@/lib/server-auth";
import { BLANK_FLOORPLAN_PREFIX, getAdminSupabase, serverConfigMissingResponse, UPLOADS_TABLE } from "@/lib/supabase-server";

export const runtime = "nodejs";

type MetaBody = { imageId?: number; address?: string; floorLabel?: string };

const MAX_FLOOR_LABEL = 40;

/** Postgres "undefined column", or PostgREST not knowing the column. */
function isMissingColumn(error: { code?: string }) {
  return error.code === "42703" || error.code === "PGRST204";
}

/**
 * PATCH /api/floorplan-meta { imageId, address, floorLabel }
 *
 * Sets the address (the image's label, as everywhere else in the app) and the floor of a scanned
 * or blank plan; both are printed on the finished plan. Empty clears. The floor column arrives
 * with database/2026-10-20-plan-floor-label.sql; before it has run only the address is saved.
 */
export async function PATCH(request: Request) {
  const session = await requireRole();
  if (!session.ok) return session.response;
  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  let body: MetaBody;
  try {
    body = (await request.json()) as MetaBody;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const imageId = body.imageId;
  if (typeof imageId !== "number" || !Number.isInteger(imageId) || imageId <= 0) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }
  if (typeof body.address === "string" && body.address.trim().length > IMAGE_LABEL_MAX_LENGTH) {
    return NextResponse.json({ message: "Adressen är för lång." }, { status: 400 });
  }
  const floorLabel = typeof body.floorLabel === "string" ? body.floorLabel.trim().replace(/\s+/g, " ") : "";
  if (floorLabel.length > MAX_FLOOR_LABEL) {
    return NextResponse.json({ message: "Våningen är för lång." }, { status: 400 });
  }
  const address = normaliseImageLabel(body.address);

  const plan = supabase.from(UPLOADS_TABLE).update({ label: address, floor_label: floorLabel || null }).eq("id", imageId).like("file_path", `${BLANK_FLOORPLAN_PREFIX}%`);
  let { data, error } = await plan.select("id");
  if (error && isMissingColumn(error)) {
    // Before the floor column exists: the address is still saved.
    ({ data, error } = await supabase
      .from(UPLOADS_TABLE)
      .update({ label: address })
      .eq("id", imageId)
      .like("file_path", `${BLANK_FLOORPLAN_PREFIX}%`)
      .select("id"));
  }
  if (error) {
    console.warn("Plan address not saved", error.message);
    return NextResponse.json({ message: "Kunde inte spara adressen." }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ message: "Bilden finns inte längre." }, { status: 404 });
  }
  return NextResponse.json({ address, floorLabel: floorLabel || null });
}

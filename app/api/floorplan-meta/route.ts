import { NextResponse } from "next/server";

import { loadApprovedPlan } from "@/lib/ownership";
import { requireSession } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse, UPLOADS_TABLE } from "@/lib/supabase-server";

type MetaBody = { imageId?: number; address?: string; floorLabel?: string };

const MAX_ADDRESS = 120;
const MAX_FLOOR_LABEL = 40;

/** Sets a plan's address and floor label, shown on the plan and used for its name. */
export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  let body: MetaBody;
  try {
    body = (await request.json()) as MetaBody;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const address = typeof body.address === "string" ? body.address.trim().replace(/\s+/g, " ") : "";
  const floorLabel = typeof body.floorLabel === "string" ? body.floorLabel.trim().replace(/\s+/g, " ") : "";
  if (address.length > MAX_ADDRESS || floorLabel.length > MAX_FLOOR_LABEL) {
    return NextResponse.json({ message: "Adressen eller våningen är för lång." }, { status: 400 });
  }

  const plan = await loadApprovedPlan(
    supabase,
    session,
    { imageId: typeof body.imageId === "number" ? body.imageId : Number.NaN },
    { forChange: true },
  );
  if (!plan.ok) return plan.response;

  const { error } = await supabase
    .from(UPLOADS_TABLE)
    .update({ address: address || null, floor_label: floorLabel || null })
    .eq("id", plan.row.id);
  if (error) {
    return NextResponse.json({ message: "Kunde inte spara adressen." }, { status: 500 });
  }
  return NextResponse.json({ address: address || null, floorLabel: floorLabel || null });
}

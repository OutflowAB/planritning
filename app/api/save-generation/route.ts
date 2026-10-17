import { NextResponse } from "next/server";

import { loadApprovedPlan } from "@/lib/ownership";
import { requireSession } from "@/lib/server-auth";
import { GENERATED_PREFIX, getAdminSupabase, serverConfigMissingResponse, UPLOADS_TABLE } from "@/lib/supabase-server";

type SaveBody = {
  imageId?: number;
  filePath?: string;
};

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }
  const imageId = typeof body.imageId === "number" ? body.imageId : Number.NaN;
  const filePath = body.filePath?.trim() ?? "";

  if (!Number.isFinite(imageId) || !filePath.startsWith(GENERATED_PREFIX)) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }

  const plan = await loadApprovedPlan(adminSupabase, session, { imageId, imagePath: filePath }, { forChange: true });
  if (!plan.ok) {
    return plan.response;
  }
  const imageRow = plan.row;

  if (imageRow.saved_at) {
    return NextResponse.json({
      success: true,
      alreadySaved: true,
      savedAt: imageRow.saved_at,
    });
  }

  const savedAt = new Date().toISOString();
  const { error: updateError } = await adminSupabase
    .from(UPLOADS_TABLE)
    .update({ saved_at: savedAt })
    .eq("id", imageRow.id)
    .eq("file_path", filePath);

  if (updateError) {
    console.error("Failed to save generated image", updateError);
    return NextResponse.json({ message: "Kunde inte spara bilden just nu." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    savedAt,
  });
}

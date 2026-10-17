import { NextResponse } from "next/server";

import { deleteUploadRecord } from "@/lib/delete-upload";
import { loadOwnedImage } from "@/lib/ownership";
import { requireSession } from "@/lib/server-auth";
import {
  GENERATED_PREFIX,
  getAdminSupabase,
  REVIEWS_TABLE,
  serverConfigMissingResponse,
  UPLOADS_TABLE,
} from "@/lib/supabase-server";

type ReviewBody = {
  action?: "approve" | "reject";
  imageId?: number;
  filePath?: string;
  comment?: string;
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

  let body: ReviewBody;
  try {
    body = (await request.json()) as ReviewBody;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }
  const action = body.action;
  const imageId = typeof body.imageId === "number" ? body.imageId : Number.NaN;
  const filePath = body.filePath?.trim() ?? "";
  const comment = body.comment?.trim() ?? "";

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ message: "Ogiltig åtgärd." }, { status: 400 });
  }

  if (!Number.isFinite(imageId) || !filePath.startsWith(GENERATED_PREFIX)) {
    return NextResponse.json({ message: "Ogiltig bildreferens." }, { status: 400 });
  }

  if (action === "reject" && !comment) {
    return NextResponse.json(
      { message: "Beskriv vad som ska bli annorlunda innan du konverterar på nytt." },
      { status: 400 },
    );
  }

  const owned = await loadOwnedImage(adminSupabase, session, imageId, {
    filePath,
    prefix: GENERATED_PREFIX,
    forChange: true,
  });
  if (!owned.ok) {
    return owned.response;
  }

  if (action === "approve") {
    const { error: reviewError } = await adminSupabase.from(REVIEWS_TABLE).insert({
      image_id: imageId,
      file_path: filePath,
      decision: "approved",
      comment: null,
    });
    // An approved plan belongs in the library from now on, finished or not.
    const { error: saveError } = await adminSupabase
      .from(UPLOADS_TABLE)
      .update({ saved_at: new Date().toISOString() })
      .eq("id", imageId);
    if (reviewError || saveError) {
      console.error("Failed to store generation review", reviewError ?? saveError);
      return NextResponse.json({ message: "Kunde inte spara granskningen." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  // A rejected generation is removed with its file and thumbnail; the comment goes with the
  // next conversion request.
  const result = await deleteUploadRecord(adminSupabase, session, imageId);
  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: result.status });
  }

  return NextResponse.json({ success: true });
}

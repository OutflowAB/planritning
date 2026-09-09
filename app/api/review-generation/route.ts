import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const REVIEWS_TABLE = "generation_reviews";
const GENERATED_PREFIX = "generated/";

type ReviewBody = {
  action?: "approve" | "reject";
  imageId?: number;
  filePath?: string;
  comment?: string;
};

export async function POST(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  const body = (await request.json()) as ReviewBody;
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

  const { data: existingImage, error: lookupError } = await adminSupabase
    .from(UPLOADS_TABLE)
    .select("id, file_path")
    .eq("id", imageId)
    .eq("file_path", filePath)
    .like("file_path", `${GENERATED_PREFIX}%`)
    .single();

  if (lookupError || !existingImage) {
    return NextResponse.json({ message: "Bilden hittades inte." }, { status: 404 });
  }

  const { error: reviewError } = await adminSupabase.from(REVIEWS_TABLE).insert({
    image_id: imageId,
    file_path: filePath,
    decision: action === "approve" ? "approved" : "rejected",
    comment: action === "reject" ? comment : null,
  });

  if (reviewError) {
    console.error("Failed to store generation review", reviewError);
    return NextResponse.json({ message: "Kunde inte spara granskningen." }, { status: 500 });
  }

  if (action === "approve") {
    return NextResponse.json({ success: true });
  }

  const { data: deletedRows, error: deleteError } = await adminSupabase
    .from(UPLOADS_TABLE)
    .delete()
    .eq("id", imageId)
    .eq("file_path", filePath)
    .select("id");

  if (deleteError) {
    return NextResponse.json({ message: "Kunde inte ta bort den genererade bilden." }, { status: 500 });
  }

  if (!deletedRows || deletedRows.length === 0) {
    return NextResponse.json({ message: "Bilden hittades inte eller är redan borttagen." }, { status: 404 });
  }

  const { error: storageError } = await adminSupabase.storage.from(BUCKET_NAME).remove([filePath]);
  if (storageError) {
    console.error("Failed to remove rejected generated image from storage", storageError);
  }

  return NextResponse.json({ success: true });
}

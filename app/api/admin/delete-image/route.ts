import { NextResponse } from "next/server";

import { deleteUploadRecord } from "@/lib/delete-upload";
import { requireRole } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

type DeleteBody = {
  id?: number;
  filePath?: string;
};

export async function POST(request: Request) {
  const session = await requireRole("admin");
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  const body = (await request.json()) as DeleteBody;
  const id = typeof body.id === "number" ? body.id : Number.NaN;
  const filePath = body.filePath?.trim() ?? "";

  if (!Number.isFinite(id) || !filePath) {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }


  const result = await deleteUploadRecord(adminSupabase, id, filePath);
  if (!result.ok) {
    const status = result.message.includes("hittades inte") ? 404 : 500;
    return NextResponse.json({ message: result.message }, { status });
  }

  return NextResponse.json({ success: true });
}

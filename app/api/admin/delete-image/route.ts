import { NextResponse } from "next/server";

import { deleteUploadRecord } from "@/lib/delete-upload";
import { requireSession } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

/** Deletes one plan: the user's own, or any plan for a superadmin. */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  let id = Number.NaN;
  try {
    const body = (await request.json()) as { id?: number };
    id = typeof body.id === "number" ? body.id : Number.NaN;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const result = await deleteUploadRecord(adminSupabase, session, id);
  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: result.status });
  }

  return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";

import { deleteUploadRecord } from "@/lib/delete-upload";
import { requireSession } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

type DeleteBody = {
  items?: { id?: number }[];
};

/** Deletes the given images; each must be the user's own (a superadmin may delete any). */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) {
    return session.response;
  }

  const adminSupabase = getAdminSupabase();
  if (!adminSupabase) {
    return serverConfigMissingResponse();
  }

  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];

  if (items.length === 0) {
    return NextResponse.json({ message: "Inga bilder angavs." }, { status: 400 });
  }

  const deletedIds: number[] = [];
  const failures: { id: number; message: string }[] = [];

  for (const item of items) {
    const id = typeof item.id === "number" ? item.id : Number.NaN;
    const result = await deleteUploadRecord(adminSupabase, session, id);
    if (result.ok) {
      deletedIds.push(result.deletedId);
    } else {
      failures.push({ id: Number.isFinite(id) ? id : -1, message: result.message });
    }
  }

  return NextResponse.json({
    deletedIds,
    failures,
    failedCount: failures.length,
    message:
      failures.length > 0
        ? failures[failures.length - 1]?.message ?? "Kunde inte ta bort alla markerade bilder."
        : undefined,
  });
}

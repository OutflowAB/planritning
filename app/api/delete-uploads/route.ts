import { NextResponse } from "next/server";

import { deleteUploadRecord } from "@/lib/delete-upload";
import { requireRole } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

type DeleteItem = {
  id?: number;
  filePath?: string;
};

type DeleteBody = {
  items?: DeleteItem[];
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

  const body = (await request.json()) as DeleteBody;
  const items = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) {
    return NextResponse.json({ message: "Inga uppladdningar angavs." }, { status: 400 });
  }


  const deletedIds: number[] = [];
  const failures: { id: number; message: string }[] = [];

  for (const item of items) {
    const id = typeof item.id === "number" ? item.id : Number.NaN;
    const filePath = item.filePath?.trim() ?? "";

    if (!Number.isFinite(id) || !filePath) {
      failures.push({ id: Number.isFinite(id) ? id : -1, message: "Ogiltig post." });
      continue;
    }

    const result = await deleteUploadRecord(adminSupabase, id, filePath);
    if (result.ok) {
      deletedIds.push(result.deletedId);
    } else {
      failures.push({ id, message: result.message });
    }
  }

  return NextResponse.json({
    deletedIds,
    failures,
    failedCount: failures.length,
    message:
      failures.length > 0
        ? failures[failures.length - 1]?.message ?? "Kunde inte ta bort alla markerade uppladdningar."
        : undefined,
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { deleteUploadRecord } from "@/lib/delete-upload";
import { createUnauthorizedResponse, getRequestRole } from "@/lib/server-auth";

type DeleteItem = {
  id?: number;
  filePath?: string;
};

type DeleteBody = {
  items?: DeleteItem[];
};

export async function POST(request: Request) {
  const role = await getRequestRole();
  if (!role) {
    const unauthorized = createUnauthorizedResponse();
    return NextResponse.json(unauthorized.body, { status: unauthorized.status });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ message: "Serverkonfiguration saknas." }, { status: 500 });
  }

  const body = (await request.json()) as DeleteBody;
  const items = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) {
    return NextResponse.json({ message: "Inga uppladdningar angavs." }, { status: 400 });
  }

  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

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

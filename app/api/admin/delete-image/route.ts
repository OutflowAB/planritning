import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { deleteUploadRecord } from "@/lib/delete-upload";
import { createUnauthorizedResponse, getRequestRole } from "@/lib/server-auth";

type DeleteBody = {
  id?: number;
  filePath?: string;
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
  const id = typeof body.id === "number" ? body.id : Number.NaN;
  const filePath = body.filePath?.trim() ?? "";

  if (!Number.isFinite(id) || !filePath) {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const result = await deleteUploadRecord(adminSupabase, id, filePath);
  if (!result.ok) {
    const status = result.message.includes("hittades inte") ? 404 : 500;
    return NextResponse.json({ message: result.message }, { status });
  }

  return NextResponse.json({ success: true });
}

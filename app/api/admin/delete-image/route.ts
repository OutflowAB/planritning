import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

type DeleteBody = {
  id?: number;
  filePath?: string;
};

type CascadedRow = {
  file_path: string;
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const role = cookieStore.get("sm_auth_role")?.value;

  if (role !== "admin") {
    return NextResponse.json({ message: "Saknar behörighet." }, { status: 403 });
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

  const { data: cascadedRows, error: cascadedRowsError } = await adminSupabase
    .from("uploaded_images")
    .select("file_path")
    .eq("source_upload_id", id)
    .like("file_path", "generated/%");

  if (cascadedRowsError) {
    return NextResponse.json(
      { message: `Kunde inte läsa kopplade genereringar: ${cascadedRowsError.message}` },
      { status: 500 },
    );
  }

  const { data: deletedRows, error: deleteError } = await adminSupabase
    .from("uploaded_images")
    .delete()
    .eq("id", id)
    .eq("file_path", filePath)
    .select("id");

  if (deleteError) {
    return NextResponse.json({ message: `Kunde inte radera post: ${deleteError.message}` }, { status: 500 });
  }

  if (!deletedRows || deletedRows.length === 0) {
    return NextResponse.json({ message: "Bilden hittades inte eller är redan borttagen." }, { status: 404 });
  }

  const cascadePaths = ((cascadedRows as CascadedRow[] | null) ?? [])
    .map((row) => row.file_path)
    .filter(Boolean);
  const uniquePaths = Array.from(new Set([filePath, ...cascadePaths]));

  const { error: storageError } = await adminSupabase.storage.from("planritningar").remove(uniquePaths);
  if (storageError) {
    return NextResponse.json(
      { message: `Posten raderades men filen kunde inte tas bort: ${storageError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";

import { thumbnailPathsFor } from "@/lib/delete-upload";
import { retentionCutoff } from "@/lib/retention";
import {
  BUCKET_NAME,
  getAdminSupabase,
  serverConfigMissingResponse,
  UPLOADS_PREFIX,
  UPLOADS_TABLE,
} from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Rows handled per run; a backlog is worked through over the following nights.
const BATCH_SIZE = 500;

/**
 * Daily retention job (Vercel cron, see vercel.json). Removes uploaded originals older than 90
 * days and their thumbnails. The rows stay, marked purged, because the plans drawn from an
 * original reference it and would go with it. Old failed sign-ins are pruned too.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Obehörig." }, { status: 401 });
  }

  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  const { data: rows, error } = await supabase
    .from(UPLOADS_TABLE)
    .select("id, file_path")
    .like("file_path", `${UPLOADS_PREFIX}%`)
    .is("purged_at", null)
    .lt("created_at", retentionCutoff().toISOString())
    .order("created_at")
    .limit(BATCH_SIZE);
  if (error) {
    console.error("Retention purge could not list uploads", error);
    return NextResponse.json({ message: "Kunde inte läsa uppladdningar." }, { status: 500 });
  }

  let purged = 0;
  for (const row of rows ?? []) {
    const thumbnails = await thumbnailPathsFor(supabase, [row.file_path]);
    const { error: removeError } = await supabase.storage.from(BUCKET_NAME).remove([row.file_path, ...thumbnails]);
    if (removeError) {
      console.error("Retention purge could not remove a file", { id: row.id, error: removeError.message });
      continue;
    }
    await supabase.from(UPLOADS_TABLE).update({ purged_at: new Date().toISOString() }).eq("id", row.id);
    purged += 1;
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("login_attempts").delete().lt("created_at", dayAgo);

  return NextResponse.json({ purged, remaining: (rows?.length ?? 0) === BATCH_SIZE });
}

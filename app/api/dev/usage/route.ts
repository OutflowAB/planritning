import { NextResponse } from "next/server";

import {
  buildDevUsage,
  type ProfileName,
  type StorageRow,
  type UsageRow,
  usageMonths,
  usageSettings,
} from "@/lib/dev-usage";
import { PROFILES_TABLE, requireSession } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * GET /api/dev/usage — spending and usage for the developer account: what the firm is billed,
 * AI redraws and their estimated cost, and what is stored, per month and per realtor. No plans,
 * addresses or images, only counts and sums.
 */
export async function GET() {
  const session = await requireSession({ role: "dev" });
  if (!session.ok) return session.response;
  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  const { since } = usageMonths();
  const [usage, storage, profiles] = await Promise.all([
    supabase.rpc("dev_usage", { since: since.toISOString() }),
    supabase.rpc("dev_storage"),
    supabase.from(PROFILES_TABLE).select("id, display_name, role").returns<ProfileName[]>(),
  ]);
  if (usage.error || storage.error || profiles.error) {
    console.error("Failed to load usage", usage.error ?? storage.error ?? profiles.error);
    return NextResponse.json({ message: "Kunde inte hämta användningen." }, { status: 500 });
  }

  return NextResponse.json(
    buildDevUsage({
      rows: (usage.data ?? []) as UsageRow[],
      storage: (storage.data ?? []) as StorageRow[],
      profiles: profiles.data ?? [],
      settings: usageSettings(),
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}

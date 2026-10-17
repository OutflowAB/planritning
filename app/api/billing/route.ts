import { NextResponse } from "next/server";

import { type BillingPeriod, planPriceOre, stockholmRange } from "@/lib/billing";
import { requireSession } from "@/lib/server-auth";
import { BILLING_EVENTS_TABLE, getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

export const runtime = "nodejs";

// Rows listed per request; totals are counted in the database and never capped.
const MAX_ITEMS = 500;

type BillingRow = {
  id: number;
  owner_id: string;
  image_id: number | null;
  price_ore: number;
  address: string | null;
  floor_label: string | null;
  created_at: string;
};

/**
 * GET /api/billing?period=day|week|month[&offset=-N][&summaryOnly=1]
 *
 * Finished plans in a Stockholm-time period: the realtor's own, or everyone's for the
 * superadmin with a total per realtor.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  const { searchParams } = new URL(request.url);
  const periodParam = searchParams.get("period");
  const period: BillingPeriod = periodParam === "day" || periodParam === "week" ? periodParam : "month";
  const offset = Math.min(0, Math.max(-120, Math.trunc(Number(searchParams.get("offset")) || 0)));
  const summaryOnly = searchParams.get("summaryOnly") === "1";
  const { from, to } = stockholmRange(period, offset);

  // Every finish is listed with what it cost then, so a price change never rewrites history.
  let query = supabase
    .from(BILLING_EVENTS_TABLE)
    .select("id, owner_id, image_id, price_ore, address, floor_label, created_at")
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString());
  if (!session.isAdmin) query = query.eq("owner_id", session.userId);
  const { data, error } = await query.order("created_at", { ascending: false }).returns<BillingRow[]>();
  if (error) {
    console.error("Failed to load billing", error);
    return NextResponse.json({ message: "Kunde inte hämta fakturering." }, { status: 500 });
  }

  const rows = data ?? [];
  const totalOre = rows.reduce((sum, row) => sum + row.price_ore, 0);
  const base = {
    from: from.toISOString(),
    to: to.toISOString(),
    count: rows.length,
    totalSek: totalOre / 100,
    priceSek: planPriceOre() / 100,
  };
  if (summaryOnly) {
    return NextResponse.json(base, { headers: { "Cache-Control": "no-store" } });
  }

  let perUser: { userId: string; displayName: string; count: number; totalSek: number }[] | undefined;
  if (session.isAdmin) {
    const { data: profiles } = await supabase.from("profiles").select("id, display_name");
    const names = new Map((profiles ?? []).map((profile) => [profile.id as string, profile.display_name as string]));
    const totals = new Map<string, { count: number; ore: number }>();
    for (const row of rows) {
      const total = totals.get(row.owner_id) ?? { count: 0, ore: 0 };
      totals.set(row.owner_id, { count: total.count + 1, ore: total.ore + row.price_ore });
    }
    perUser = [...totals.entries()]
      .map(([userId, total]) => ({
        userId,
        displayName: names.get(userId) ?? "Okänd",
        count: total.count,
        totalSek: total.ore / 100,
      }))
      .sort((a, b) => b.totalSek - a.totalSek);
  }

  return NextResponse.json(
    { ...base, items: rows.slice(0, MAX_ITEMS), perUser },
    { headers: { "Cache-Control": "no-store" } },
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { UPLOADS_TABLE } from "@/lib/supabase-server";

/**
 * The address (the image's label) and floor of the given images, read best-effort: the label
 * column arrives with database/2026-10-15-uploaded-images-label.sql and the floor column with
 * database/2026-10-20-plan-floor-label.sql, and nothing may fail before they have run.
 */
export async function readPlanMeta(
  supabase: SupabaseClient,
  ids: number[],
): Promise<Map<number, { address: string | null; floorLabel: string | null }>> {
  const meta = new Map<number, { address: string | null; floorLabel: string | null }>();
  if (ids.length === 0) return meta;

  type Row = { id: number; label: string | null; floor_label?: string | null };
  const withFloor = await supabase.from(UPLOADS_TABLE).select("id, label, floor_label").in("id", ids);
  const found = withFloor.error ? await supabase.from(UPLOADS_TABLE).select("id, label").in("id", ids) : withFloor;
  if (found.error || !found.data) return meta;
  for (const row of found.data as Row[]) {
    meta.set(row.id, { address: row.label ?? null, floorLabel: row.floor_label ?? null });
  }
  return meta;
}

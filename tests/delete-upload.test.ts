import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { deleteUploadRecord } from "@/lib/delete-upload";

type Row = { id: number; owner_id: string; file_path: string; published_path: string | null; source_upload_id: number | null };

/** Just enough of a Supabase client for the delete path: rows in memory, foreign keys cascading. */
function fakeSupabase(rows: Row[]) {
  const query = () => {
    const filters: Array<(row: Row) => boolean> = [];
    let mode: "select" | "delete" = "select";
    let head = false;
    const matching = () => rows.filter((row) => filters.every((keep) => keep(row)));
    const run = () => {
      if (mode === "delete") {
        const gone = new Set(matching().map((row) => row.id));
        const before = rows.length;
        // source_upload_id cascades: plans go with their original
        for (let i = rows.length - 1; i >= 0; i--) {
          if (gone.has(rows[i].id) || (rows[i].source_upload_id !== null && gone.has(rows[i].source_upload_id!))) rows.splice(i, 1);
        }
        return { data: null, error: null, count: before - rows.length };
      }
      const found = matching();
      return { data: head ? null : found, error: null, count: found.length };
    };
    const builder: Record<string, unknown> = {
      select: (_columns?: string, options?: { head?: boolean }) => {
        head = options?.head ?? false;
        return builder;
      },
      delete: () => {
        mode = "delete";
        return builder;
      },
      eq: (column: keyof Row, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      like: () => builder,
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };
    return builder;
  };
  const removed: string[][] = [];
  const client = {
    from: () => query(),
    storage: {
      from: () => ({
        list: async () => ({ data: [] }),
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, rows, removed };
}

const row = (id: number, source: number | null, owner = "u1"): Row => ({
  id,
  owner_id: owner,
  file_path: source === null ? `uploads/${id}.png` : `generated/${id}.png`,
  published_path: null,
  source_upload_id: source,
});
const user = { userId: "u1", isAdmin: false };

describe("deleteUploadRecord", () => {
  it("deletes the original along with the last plan made from it", async () => {
    const { client, rows, removed } = fakeSupabase([row(1, null), row(2, 1)]);
    expect(await deleteUploadRecord(client, user, 2)).toEqual({ ok: true, deletedId: 2 });
    expect(rows).toEqual([]);
    expect(removed.flat()).toContain("uploads/1.png");
  });

  it("keeps the original while another plan still comes from it", async () => {
    const { client, rows } = fakeSupabase([row(1, null), row(2, 1), row(3, 1)]);
    await deleteUploadRecord(client, user, 2);
    expect(rows.map((r) => r.id)).toEqual([1, 3]);
  });

  it("deleting an original still takes its plans with it", async () => {
    const { client, rows } = fakeSupabase([row(1, null), row(2, 1), row(3, 1), row(9, null)]);
    await deleteUploadRecord(client, user, 1);
    expect(rows.map((r) => r.id)).toEqual([9]);
  });

  it("does not touch another user's plan or original", async () => {
    const { client, rows } = fakeSupabase([row(1, null, "u2"), row(2, 1, "u2")]);
    const result = await deleteUploadRecord(client, user, 2);
    expect(result.ok).toBe(false);
    expect(rows).toHaveLength(2);
  });
});

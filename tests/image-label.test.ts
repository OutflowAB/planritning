import { beforeEach, describe, expect, it, vi } from "vitest";

import { normaliseImageLabel } from "@/lib/image-label";

type UpdateCall = { patch: Record<string, unknown>; ids: number[] };

const mocks = vi.hoisted(() => ({
  supabase: null as unknown,
  updates: [] as UpdateCall[],
  failWith: null as string | null,
}));

vi.mock("@/lib/server-auth", () => ({
  requireRole: vi.fn(async () => ({ ok: true, role: "user" })),
}));

vi.mock("@/lib/supabase-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase-server")>()),
  getAdminSupabase: () => mocks.supabase,
}));

const { POST } = await import("@/app/api/image-label/route");

/** Just the `update().in().select()` chain the route uses. */
function fakeClient() {
  return {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        in: (_column: string, ids: number[]) => ({
          select: async () => {
            if (mocks.failWith) {
              return { data: null, error: { message: mocks.failWith } };
            }
            mocks.updates.push({ patch, ids });
            return { data: ids.map((id) => ({ id })), error: null };
          },
        }),
      }),
    }),
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/image-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mocks.supabase = fakeClient();
  mocks.updates = [];
  mocks.failWith = null;
});

describe("normaliseImageLabel", () => {
  it("trims and collapses whitespace", () => {
    expect(normaliseImageLabel("  Storgatan   12,\n Göteborg ")).toBe("Storgatan 12, Göteborg");
  });

  it("treats blank and non-strings as no name", () => {
    expect(normaliseImageLabel("   ")).toBeNull();
    expect(normaliseImageLabel(null)).toBeNull();
    expect(normaliseImageLabel(42)).toBeNull();
  });
});

describe("/api/image-label", () => {
  it("names a plan and its original together", async () => {
    const response = await post({ ids: [301, 300], label: " Storgatan 12 " });

    expect(response.status).toBe(200);
    expect(mocks.updates).toEqual([{ patch: { label: "Storgatan 12" }, ids: [301, 300] }]);
  });

  it("clears the name when given an empty label", async () => {
    const response = await post({ ids: [301], label: "" });

    expect(response.status).toBe(200);
    expect(mocks.updates).toEqual([{ patch: { label: null }, ids: [301] }]);
  });

  it("drops duplicate and invalid ids", async () => {
    await post({ ids: [5, 5, -1, 2.5, "7", 6], label: "Villa" });

    expect(mocks.updates[0].ids).toEqual([5, 6]);
  });

  it("rejects requests without usable ids, or with a label that is too long", async () => {
    expect((await post({ ids: [], label: "x" })).status).toBe(400);
    expect((await post({ label: "x" })).status).toBe(400);
    expect((await post({ ids: [1], label: 12 })).status).toBe(400);
    expect((await post({ ids: [1], label: "x".repeat(121) })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(mocks.updates).toEqual([]);
  });

  it("answers 503 rather than failing hard before the migration has run", async () => {
    mocks.failWith = "column uploaded_images.label does not exist";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await post({ ids: [1], label: "Villa" });

    expect(response.status).toBe(503);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2026-10-15-uploaded-images-label.sql"));
    warn.mockRestore();
  });
});

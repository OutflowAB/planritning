import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseRoomplan } from "@/lib/polycam/parse-roomplan";
import { listStoreys, renderPlan } from "@/lib/polycam/render-plan";

const load = (name: string) =>
  parseRoomplan(JSON.parse(readFileSync(`tests/fixtures/polycam/${name}`, "utf8")));
const multi = load("multi-storey-optimized-roomplan.json");
const single = load("sample-optimized-roomplan.json");

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

describe("storey detection", () => {
  it("lists the four storeys of the multi-storey scan, lowest first, with hints", () => {
    const storeys = listStoreys(multi);
    expect(storeys.map((s) => s.story)).toEqual([0, 1, 2, 3]);
    expect(storeys.map((s) => s.wallCount)).toEqual([33, 24, 24, 10]);
    expect(storeys.map((s) => s.roomCount)).toEqual([10, 8, 6, 2]);
    expect(storeys.every((s) => s.areaM2 > 0)).toBe(true);
  });

  it("reports one storey for the single-storey sample", () => {
    expect(listStoreys(single)).toHaveLength(1);
  });

  it("keeps openings on the storey of their wall", () => {
    const wallStory = new Map(multi.walls.map((w) => [w.id, w.story]));
    for (const opening of multi.openings) {
      if (opening.parentWallId && wallStory.has(opening.parentWallId)) {
        expect(opening.story).toBe(wallStory.get(opening.parentWallId));
      }
    }
  });
});

describe("rendering one storey", () => {
  it("renders every storey to a non-empty, different plan", async () => {
    const plans = [];
    for (const { story } of listStoreys(multi)) {
      plans.push(await renderPlan(multi, { story }));
    }
    expect(plans.map((p) => p.story)).toEqual([0, 1, 2, 3]);
    expect(plans.every((p) => p.wallCount > 0 && p.png.byteLength > 1000)).toBe(true);
    expect(new Set(plans.map((p) => sha(p.png))).size).toBe(4);
  });

  it("draws the lowest storey by default, identically to asking for it", async () => {
    const lowest = await renderPlan(multi, { story: 0 });
    expect(sha((await renderPlan(multi)).png)).toBe(sha(lowest.png));
  });

  it("leaves the single-storey output unchanged by the storey parameter", async () => {
    const plain = await renderPlan(single);
    expect(sha((await renderPlan(single, { story: plain.story })).png)).toBe(sha(plain.png));
    // Pinned so an accidental change to the drawing shows up; update on purpose only.
    expect(sha(plain.png)).toBe(SAMPLE_SHA);
  });

  it("refuses a storey the scan does not have", async () => {
    await expect(renderPlan(multi, { story: 9 })).rejects.toThrow("Den valda våningen finns inte");
  });
});

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), fetchRoomplan: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/polycam/fetch-roomplan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/polycam/fetch-roomplan")>()),
  fetchRoomplan: mocks.fetchRoomplan,
}));

const { POST } = await import("@/app/api/convert-polycam/inspect/route");
const ID = "CE2053F4-1E9E-48C3-9525-4AC4EA4053DC";
const inspect = (body: unknown) =>
  POST(new Request("http://localhost/api/convert-polycam/inspect", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/convert-polycam/inspect", () => {
  beforeEach(() => {
    mocks.requireRole.mockReset().mockResolvedValue({ ok: true, role: "user" });
    mocks.fetchRoomplan
      .mockReset()
      .mockResolvedValue(JSON.parse(readFileSync("tests/fixtures/polycam/multi-storey-optimized-roomplan.json", "utf8")));
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the storeys without generating anything", async () => {
    const response = await inspect({ url: `https://poly.cam/capture/${ID}` });
    expect(response.status).toBe(200);
    const { storeys } = await response.json();
    expect(storeys).toHaveLength(4);
    expect(mocks.fetchRoomplan).toHaveBeenCalledWith(ID, expect.anything());
  });

  it("answers 401 before fetching when the role check fails", async () => {
    mocks.requireRole.mockResolvedValueOnce({ ok: false, response: new Response("{}", { status: 401 }) });
    expect((await inspect({ url: `https://poly.cam/capture/${ID}` })).status).toBe(401);
    expect(mocks.fetchRoomplan).not.toHaveBeenCalled();
  });

  it("rejects a link that is not a Polycam capture, without fetching", async () => {
    const response = await inspect({ url: "https://evil.example.com/capture/" + ID });
    expect(response.status).toBe(400);
    expect(mocks.fetchRoomplan).not.toHaveBeenCalled();
  });
});

const SAMPLE_SHA = "99f7258977e30530b7784f52448e2aa402acf02f4754f48bc8ae3d3945491d22";

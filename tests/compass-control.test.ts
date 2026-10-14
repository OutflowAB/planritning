import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseFloorGroup } from "@/lib/floor-groups";
import { readConvertStream } from "@/lib/floorplan/convert-stream";
import {
  compassRotationToDraw,
  defaultCompass,
  normaliseRotation,
  parseCompassFormFields,
  parseCompassSettings,
} from "@/lib/image/compass-settings";

import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  supabase: null as unknown,
  generate: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/supabase-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase-server")>()),
  getAdminSupabase: () => mocks.supabase,
}));
vi.mock("@/lib/image/ai-floorplan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image/ai-floorplan")>()),
  generateFloorplanLineArt: mocks.generate,
  resolveImageEngine: () => "ai",
}));

const { POST: scanPOST } = await import("@/app/api/convert-polycam/route");
const { POST: photoPOST } = await import("@/app/api/convert/route");
const recompose = await import("@/app/api/recompose-sheet/route");

const ID = "FA402246-4F1C-48EA-886A-C4E773CD7E4E";
const API_URL = `https://poly.cam/api/capture/${ID}/artifacts/optimized_roomplan.json`;
const STORAGE_URL = "https://bucket.r2.cloudflarestorage.com/x.json?X-Amz-Signature=secret";

let referencePng: Buffer;
let roomplanText: string;
let fake: FakeSupabase;
const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  referencePng = await sharp(
    readFileSync(path.resolve(__dirname, "../assets/style-references/03-drottninggatan-107a.webp")),
  )
    .png()
    .toBuffer();
  roomplanText = readFileSync(
    path.resolve(__dirname, "fixtures/polycam/sample-optimized-roomplan.json"),
    "utf8",
  );
});

beforeEach(() => {
  fake = createFakeSupabase();
  mocks.supabase = fake.client;
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ ok: true, role: "user" });
  mocks.generate.mockReset();
  mocks.generate.mockImplementation(async () => ({
    buffer: referencePng,
    width: 1024,
    height: 732,
    model: "mock",
    quality: "high",
    size: "1024x732",
    styleReferenceCount: 6,
    usage: null,
  }));
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) =>
    String(input) === API_URL
      ? new Response(null, { status: 302, headers: { location: STORAGE_URL } })
      : new Response(roomplanText, { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  for (const method of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function scanRequest(extra: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/convert-polycam", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `https://poly.cam/capture/${ID}`, ...extra }),
  });
}

function photoRequest(fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(referencePng)], "plan.png", { type: "image/png" }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request("http://localhost/api/convert", { method: "POST", body: form });
}

const done = (response: Response) => readConvertStream(response);

describe("compass settings parsing", () => {
  it("wraps angles into 0-360", () => {
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(359.97)).toBe(0);
  });

  it("accepts a well-formed choice and nothing else", () => {
    expect(parseCompassSettings({ visible: true, rotation: 375 })).toEqual({ visible: true, rotation: 15 });
    expect(parseCompassSettings({ visible: "yes", rotation: 10 })).toBeNull();
    expect(parseCompassSettings({ visible: true, rotation: "abc" })).toBeNull();
    expect(parseCompassSettings({ visible: true, rotation: Infinity })).toBeNull();
    expect(parseCompassSettings(null)).toBeNull();
    expect(parseCompassSettings([])).toBeNull();
  });

  it("reads form fields", () => {
    expect(parseCompassFormFields("1", "30")).toEqual({ visible: true, rotation: 30 });
    expect(parseCompassFormFields("0", null)).toEqual({ visible: false, rotation: 0 });
    expect(parseCompassFormFields("maybe", "30")).toBeNull();
    expect(parseCompassFormFields(null, null)).toBeNull();
  });

  it("starts scans shown and photos hidden, and draws nothing when hidden", () => {
    expect(defaultCompass(120)).toEqual({ visible: true, rotation: 120 });
    expect(defaultCompass(null)).toEqual({ visible: false, rotation: 0 });
    expect(compassRotationToDraw({ visible: false, rotation: 40 })).toBeNull();
    expect(compassRotationToDraw({ visible: true, rotation: 40 })).toBe(40);
  });
});

describe("compass choice on the convert routes", () => {
  it("defaults a scan to its own direction and keeps the raw drawing for later", async () => {
    const result = await done(await scanPOST(scanRequest()));
    expect(result.compass).toMatchObject({ visible: true, adjustable: true });
    expect(result.compass?.rotation).toBeCloseTo(299.1, 1);
    expect(result.compass?.scanRotation).toBeCloseTo(299.1, 1);
    const base = result.savedImagePath.replace(/^generated\//, "raw/").replace(/\.png$/, "");
    expect(fake.storage.has(`${base}.png`)).toBe(true);
    expect(JSON.parse(fake.storage.get(`${base}.json`)!.toString())).toMatchObject({
      engine: "ai",
      sourceKind: "scan",
      compass: { visible: true },
    });
  });

  it("uses the broker's choice for a scan, wrapped into range", async () => {
    const result = await done(await scanPOST(scanRequest({ compass: { visible: true, rotation: 450 } })));
    expect(result.compass).toMatchObject({ visible: true, rotation: 90 });
    expect(result.compass?.scanRotation).toBeCloseTo(299.1, 1);
  });

  it("can hide a scan's compass", async () => {
    const result = await done(await scanPOST(scanRequest({ compass: { visible: false, rotation: 10 } })));
    expect(result.compass?.visible).toBe(false);
  });

  it("ignores a malformed choice and falls back to the scan", async () => {
    const result = await done(await scanPOST(scanRequest({ compass: { visible: "yes", rotation: "x" } })));
    expect(result.compass?.visible).toBe(true);
    expect(result.compass?.rotation).toBeCloseTo(299.1, 1);
  });

  it("hides a photo's compass by default and honours form fields", async () => {
    const plain = await done(await photoPOST(photoRequest()));
    expect(plain.compass).toMatchObject({ visible: false, rotation: 0, scanRotation: null });
    const chosen = await done(
      await photoPOST(photoRequest({ compassVisible: "1", compassRotation: "-30" })),
    );
    expect(chosen.compass).toMatchObject({ visible: true, rotation: 330, scanRotation: null });
  });
});

describe("floor group on the scan route", () => {
  const group = { run: "0123456789ab", position: 1, total: 3 };

  it("stores a floor of a house under a name that carries the group", async () => {
    const result = await done(await scanPOST(scanRequest({ floorGroup: group })));
    expect(result.savedImagePath).toMatch(/^generated\/\d+-[0-9a-f-]{36}-g0123456789ab-f1-n3\.png$/);
    expect(parseFloorGroup(result.savedImagePath)).toEqual(group);
    // The raw drawing follows the same name.
    expect(fake.storage.has(result.savedImagePath.replace("generated/", "raw/"))).toBe(true);
  });

  it.each([
    ["no group", {}],
    ["an invalid run", { floorGroup: { run: "../x", position: 0, total: 2 } }],
    ["a position outside the house", { floorGroup: { run: "0123456789ab", position: 5, total: 2 } }],
  ])("keeps the plain name for %s", async (_label, extra) => {
    const result = await done(await scanPOST(scanRequest(extra)));
    expect(parseFloorGroup(result.savedImagePath)).toBeNull();
    expect(result.savedImagePath).toMatch(/^generated\/\d+-[0-9a-f-]{36}\.png$/);
  });

  it("never groups a photo", async () => {
    const result = await done(await photoPOST(photoRequest()));
    expect(parseFloorGroup(result.savedImagePath)).toBeNull();
  });
});

describe("/api/recompose-sheet", () => {
  async function generatedScan() {
    const result = await done(await scanPOST(scanRequest()));
    mocks.generate.mockClear();
    return result;
  }

  const post = (body: unknown) =>
    recompose.POST(
      new Request("http://localhost/api/recompose-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it.each([401, 403])("answers %i before touching storage when the role check fails", async (status) => {
    mocks.requireRole.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ message: "Nej" }), { status }),
    });
    const before = fake.calls.length;
    const response = await post({ imageId: 1, compass: { visible: true, rotation: 0 } });
    expect(response.status).toBe(status);
    expect(fake.calls.length).toBe(before);
    mocks.requireRole.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ message: "Nej" }), { status }),
    });
    const get = await recompose.GET(new Request("http://localhost/api/recompose-sheet?imageId=1"));
    expect(get.status).toBe(status);
    expect(fake.calls.length).toBe(before);
  });

  it("re-composes with the new settings without any image model call", async () => {
    const generated = await generatedScan();
    const before = fake.storage.get(generated.savedImagePath)!;

    const response = await post({
      imageId: generated.savedImageId,
      compass: { visible: false, rotation: 0 },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ visible: false, adjustable: true });
    expect(body.savedImageUrl).toContain(`id=${generated.savedImageId}`);

    expect(mocks.generate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2); // only the original Polycam download

    const after = fake.storage.get(generated.savedImagePath)!;
    expect(after.equals(before)).toBe(false);
    expect((await sharp(after).metadata()).width).toBe((await sharp(before).metadata()).width);
    expect(fake.table.get(generated.savedImageId)?.file_size).toBe(after.byteLength);

    // The stored settings follow, so a later GET reports the new state.
    const get = await recompose.GET(
      new Request(`http://localhost/api/recompose-sheet?imageId=${generated.savedImageId}`),
    );
    expect(await get.json()).toMatchObject({ visible: false, adjustable: true });
  });

  it("composes the same sheet again for the same settings", async () => {
    const generated = await generatedScan();
    const original = fake.storage.get(generated.savedImagePath)!;
    const response = await post({
      imageId: generated.savedImageId,
      compass: { visible: true, rotation: generated.compass!.rotation },
    });
    expect(response.status).toBe(200);
    expect(fake.storage.get(generated.savedImagePath)!.equals(original)).toBe(true);
  });

  it("refuses a plan without a stored drawing, and says why on GET", async () => {
    fake = createFakeSupabase({
      rows: [{ id: 7, file_name: "x.png", file_path: "generated/old.png", file_size: 10, mime_type: "image/png" }],
      objects: { "generated/old.png": Buffer.from("x") },
    });
    mocks.supabase = fake.client;
    const response = await post({ imageId: 7, compass: { visible: true, rotation: 0 } });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("not-adjustable");
    const get = await recompose.GET(new Request("http://localhost/api/recompose-sheet?imageId=7"));
    expect(await get.json()).toMatchObject({ adjustable: false });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("refuses a sheet that was edited since it was composed", async () => {
    const generated = await generatedScan();
    fake.table.get(generated.savedImageId)!.file_size = 1;
    const response = await post({
      imageId: generated.savedImageId,
      compass: { visible: true, rotation: 10 },
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("edited");
  });

  it.each([
    ["no settings", { imageId: 1 }],
    ["bad rotation", { imageId: 1, compass: { visible: true, rotation: "x" } }],
    ["bad id", { imageId: "abc", compass: { visible: true, rotation: 0 } }],
  ])("rejects %s", async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
  });

  it("only touches generated sheets", async () => {
    fake = createFakeSupabase({
      rows: [{ id: 9, file_name: "x.png", file_path: "uploads/a.png", file_size: 10, mime_type: "image/png" }],
    });
    mocks.supabase = fake.client;
    const response = await post({ imageId: 9, compass: { visible: true, rotation: 0 } });
    expect(response.status).toBe(404);
  });
});

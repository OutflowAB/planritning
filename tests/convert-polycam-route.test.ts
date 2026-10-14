import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { readConvertStream } from "@/lib/floorplan/convert-stream";

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

const { POST } = await import("@/app/api/convert-polycam/route");
const { POST: photoPOST } = await import("@/app/api/convert/route");

const ID = "FA402246-4F1C-48EA-886A-C4E773CD7E4E";
const API_URL = `https://poly.cam/api/capture/${ID}/artifacts/optimized_roomplan.json`;
const STORAGE_URL = "https://bucket.r2.cloudflarestorage.com/x.json?X-Amz-Signature=secret";
/** Planted in the served file to prove it never reaches storage, rows or logs. */
const GPS = { latitude: 59.329323, longitude: 18.068581, altitude: 21.987654 };

let referencePng: Buffer;
let roomplanText: string;
let fake: FakeSupabase;
const fetchMock = vi.fn<typeof fetch>();
const logged: string[] = [];

beforeAll(async () => {
  referencePng = await sharp(
    readFileSync(path.resolve(__dirname, "../assets/style-references/03-drottninggatan-107a.webp")),
  )
    .png()
    .toBuffer();
  const sample = JSON.parse(
    readFileSync(path.resolve(__dirname, "fixtures/polycam/sample-optimized-roomplan.json"), "utf8"),
  );
  roomplanText = JSON.stringify({ ...sample, latLonAlt: GPS });
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
  logged.length = 0;
  for (const method of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/convert-polycam", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function collect(response: Response) {
  const statuses: string[] = [];
  const done = await readConvertStream(response, { onStatus: (event) => statuses.push(event.message) });
  return { statuses, done };
}

describe("POST /api/convert-polycam", () => {
  it.each([401, 403])("answers %i before any fetch or database call when the role check fails", async (status) => {
    mocks.requireRole.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ message: "Nej" }), { status }),
    });
    const response = await POST(jsonRequest({ url: `https://poly.cam/capture/${ID}` }));
    expect(response.status).toBe(status);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each([
    ["no link", {}],
    ["another host", { url: `https://evil.example.com/capture/${ID}` }],
    ["plain http", { url: `http://poly.cam/capture/${ID}` }],
    ["a link that is not a string", { url: ["https://poly.cam/capture/" + ID] }],
  ])("rejects %s with a Swedish message and never fetches", async (_label, body) => {
    const response = await POST(jsonRequest(body));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/^Klistra in en länk till en Polycam-skanning/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([["not JSON", "{url:"], ["a JSON array", "[]"], ["a JSON string", '"x"']])(
    "rejects a body that is %s",
    async (_label, body) => {
      const response = await POST(jsonRequest(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ message: "Ogiltig förfrågan." });
    },
  );

  it("rejects an oversized body", async () => {
    const response = await POST(jsonRequest({ url: `https://poly.cam/capture/${ID}`, feedback: "x".repeat(20_000) }));
    expect(response.status).toBe(413);
  });

  it("answers with the server-config message when Supabase is missing", async () => {
    mocks.supabase = null;
    const response = await POST(jsonRequest({ url: `https://poly.cam/capture/${ID}` }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Serverkonfiguration saknas." });
  });

  it("converts a capture link through the shared pipeline", async () => {
    const response = await POST(
      jsonRequest({ url: `https://poly.cam/explore/capture/${ID.toLowerCase()}/Sep-21-0850-AM?utm=x` }),
    );
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const { statuses, done } = await collect(response);

    expect(statuses).toEqual([
      "Hämtar planritningen från Polycam",
      "Ritar upp planen",
      "Förbereder planritningen",
      "Ritar om planritningen",
      "Sätter ram och logotyp",
      "Sparar planritning",
    ]);

    // The server built the URL from the id; the pasted text was never fetched.
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([API_URL, STORAGE_URL]);

    // The model was told this is a scan, and given the rendered plan.
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const call = mocks.generate.mock.calls[0][0];
    expect(call.sourceKind).toBe("scan");
    expect(Math.max(call.sourceWidth, call.sourceHeight)).toBe(2560);

    // The rendered plan is the stored source, so the compare slider and cascade delete work.
    const source = fake.table.get(done.sourceImageId);
    expect(source?.file_path).toMatch(/^uploads\/polycam-\d+-[0-9a-f-]+\.png$/);
    expect(source?.mime_type).toBe("image/png");
    const storedSource = fake.storage.get(source?.file_path as string);
    expect((await sharp(storedSource).metadata()).height).toBe(2560);
    expect(fake.table.get(done.savedImageId)?.source_upload_id).toBe(done.sourceImageId);

    // GPS from the file, and the presigned URL, appear nowhere.
    const everything = JSON.stringify([...fake.table.values(), fake.calls, logged, done]);
    for (const value of Object.values(GPS)) {
      expect(everything).not.toContain(String(value));
    }
    expect(everything).not.toContain("X-Amz-Signature");
    expect(logged.some((line) => line.includes("Polycam plan rendered"))).toBe(true);
  });

  it("records the canonical capture link on the source, never the pasted text", async () => {
    const { done } = await collect(
      await POST(jsonRequest({ url: `https://poly.cam/explore/capture/${ID}/Sep-21-0850-AM?utm=x` })),
    );
    expect(fake.table.get(done.sourceImageId)?.source_url).toBe(`https://poly.cam/capture/${ID}`);
    expect(fake.table.get(done.savedImageId)).not.toHaveProperty("source_url");
  });

  it("still converts when the source_url migration has not run", async () => {
    fake = createFakeSupabase({ missingColumns: ["source_url"] });
    mocks.supabase = fake.client;

    const { done } = await collect(await POST(jsonRequest({ url: `https://poly.cam/capture/${ID}` })));

    expect(done.savedImageId).toBeGreaterThan(0);
    expect(fake.table.get(done.sourceImageId)).not.toHaveProperty("source_url");
    expect(logged.some((line) => line.includes("2026-10-14-uploaded-images-source-url.sql"))).toBe(true);
  });

  it("emits a done event shaped exactly like the photo route's", async () => {
    const { done: scanDone } = await collect(await POST(jsonRequest({ url: `https://poly.cam/capture/${ID}` })));

    const form = new FormData();
    form.append("file", new File([new Uint8Array(referencePng)], "plan.png", { type: "image/png" }));
    const { done: photoDone } = await collect(
      await photoPOST(new Request("http://localhost/api/convert", { method: "POST", body: form })),
    );

    const shape = (value: unknown): unknown =>
      value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]))
        : typeof value;
    expect(shape(scanDone)).toEqual(shape(photoDone));
  });

  it.each([
    [403, /privat eller felaktig/],
    [404, /saknar planritning/],
    [500, /Försök igen om en stund/],
  ])("turns a Polycam %i into a Swedish error event", async (status, message) => {
    fetchMock.mockImplementation(async () => new Response("", { status }));
    await expect(collect(await POST(jsonRequest({ url: `https://poly.cam/capture/${ID}` })))).rejects.toThrow(
      message,
    );
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
  });

  it("reports a file that is not a floor plan", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input) === API_URL
        ? new Response(null, { status: 302, headers: { location: STORAGE_URL } })
        : new Response(JSON.stringify({ hello: "world" })),
    );
    await expect(collect(await POST(jsonRequest({ url: `https://poly.cam/capture/${ID}` })))).rejects.toThrow(
      "Planritningen från Polycam kunde inte läsas.",
    );
  });

  it("redraws from the stored plan without contacting Polycam", async () => {
    const storedPlan = await sharp({
      create: { width: 600, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    fake = createFakeSupabase({
      rows: [{ id: 42, file_name: "bild-42.png", file_path: "uploads/polycam-plan.png", mime_type: "image/png" }],
      objects: { "uploads/polycam-plan.png": storedPlan },
    });
    mocks.supabase = fake.client;

    const { statuses, done } = await collect(
      await POST(jsonRequest({ sourceImageId: 42, feedback: "  Större fönster. " })),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(statuses[0]).toBe("Förbereder planritningen");
    expect(done.sourceImageId).toBe(42);
    const call = mocks.generate.mock.calls[0][0];
    expect(call).toMatchObject({ sourceKind: "scan", feedback: "Större fönster.", sourceWidth: 600 });
    // The source is reused, not stored again: only the result and its thumbnail are uploaded.
    expect(fake.calls.filter((entry) => entry.op === "upload")).toHaveLength(2);
  });

  it.each([
    ["an unknown id", {}],
    ["a generated image", { 42: "generated/x.png" }],
    ["a photo upload", { 42: "uploads/1791-photo.png" }],
  ])("refuses to redraw from %s", async (_label, paths: Record<number, string>) => {
    fake = createFakeSupabase({
      rows: Object.entries(paths).map(([id, filePath]) => ({
        id: Number(id),
        file_name: "x.png",
        file_path: filePath,
        mime_type: "image/png",
      })),
    });
    mocks.supabase = fake.client;
    const response = await POST(jsonRequest({ sourceImageId: 42 }));
    expect(response.status).toBe(404);
    expect((await response.json()).message).toMatch(/Källbilden kunde inte hittas/);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { readConvertStream } from "@/lib/floorplan/convert-stream";

import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  supabase: null as unknown,
  generate: vi.fn(),
  engine: vi.fn(() => "ai" as "ai" | "algorithm"),
}));

vi.mock("@/lib/server-auth", () => ({
  requireRole: vi.fn(async () => ({ ok: true, role: "user" })),
}));

vi.mock("@/lib/supabase-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase-server")>()),
  getAdminSupabase: () => mocks.supabase,
}));

vi.mock("@/lib/image/ai-floorplan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image/ai-floorplan")>()),
  generateFloorplanLineArt: mocks.generate,
  resolveImageEngine: mocks.engine,
}));

const { POST } = await import("@/app/api/convert/route");

/** An approved reference plan stands in for the model's drawing, so it passes the style gate. */
let referencePng: Buffer;
let fake: FakeSupabase;

beforeAll(async () => {
  referencePng = await sharp(
    readFileSync(path.resolve(__dirname, "../assets/style-references/03-drottninggatan-107a.webp")),
  )
    .png()
    .toBuffer();
});

beforeEach(() => {
  fake = createFakeSupabase();
  mocks.supabase = fake.client;
  mocks.engine.mockReturnValue("ai");
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
});

function photoRequest(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return new Request("http://localhost/api/convert", { method: "POST", body: form });
}

async function photoFile() {
  const png = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect x="40" y="40" width="320" height="220" fill="none" stroke="#000" stroke-width="8"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  return new File([new Uint8Array(png)], "plan.png", { type: "image/png" });
}

async function collect(response: Response) {
  const statuses: string[] = [];
  const done = await readConvertStream(response, { onStatus: (event) => statuses.push(event.message) });
  return { statuses, done };
}

describe("POST /api/convert", () => {
  it("rejects a request without a file", async () => {
    const response = await POST(photoRequest({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Ingen bildfil skickades." });
  });

  it("rejects a file that is not an image", async () => {
    const response = await POST(
      photoRequest({ file: new File(["hej"], "a.txt", { type: "text/plain" }) }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Filen måste vara en bild." });
  });

  it("streams the same status sequence and done event as before the refactor", async () => {
    const response = await POST(photoRequest({ file: await photoFile() }));
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const { statuses, done } = await collect(response);

    expect(statuses).toEqual([
      "Förbereder uppladdad bild",
      "Ritar om planritningen",
      "Sätter ram och logotyp",
      "Sparar planritning",
    ]);
    expect(Object.keys(done).sort()).toEqual(
      [
        "compareBefore",
        "engine",
        "layout",
        "result",
        "savedImageId",
        "savedImagePath",
        "savedImageUrl",
        "sourceImageId",
        "type",
      ].sort(),
    );
    expect(done.engine).toBe("ai");
    expect(done.savedImageUrl).toBe(`/api/image?id=${done.savedImageId}&variant=full&v=etag-1`);
    expect(done.result).toBe("");
    expect(done.compareBefore.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(done.savedImagePath.startsWith("generated/")).toBe(true);

    // The original is stored first, then the result linked back to it.
    const source = fake.table.get(done.sourceImageId);
    expect(source?.file_path).toMatch(/^uploads\/\d+-[0-9a-f-]+\.png$/);
    expect(source?.file_name).toBe(`bild-${done.sourceImageId}.png`);
    expect(source?.mime_type).toBe("image/png");
    const generated = fake.table.get(done.savedImageId);
    expect(generated?.source_upload_id).toBe(done.sourceImageId);
    expect(generated?.file_name).toBe(`bild-${done.savedImageId}.png`);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.generate.mock.calls[0][0]).toHaveProperty("sourceKind", "photo");
    // The source link column belongs to scans; a photo upload never touches it.
    expect(JSON.stringify(fake.calls)).not.toContain("source_url");
  });

  it("reuses an existing source upload instead of storing it again", async () => {
    fake = createFakeSupabase({ rows: [{ id: 7, file_path: "uploads/old.png" }] });
    mocks.supabase = fake.client;

    const { done } = await collect(
      await POST(photoRequest({ file: await photoFile(), sourceImageId: "7", feedback: "  tjockare väggar " })),
    );

    expect(done.sourceImageId).toBe(7);
    expect(fake.calls.filter((call) => call.op === "upload")).toHaveLength(2); // result + thumbnail
    expect(mocks.generate.mock.calls[0][0].feedback).toBe("tjockare väggar");
  });

  it("reports a missing source upload in Swedish", async () => {
    await expect(
      collect(await POST(photoRequest({ file: await photoFile(), sourceImageId: "999" }))),
    ).rejects.toThrow("Källbilden kunde inte hittas. Välj bilden igen.");
  });

  it("falls back to the algorithm when the AI step fails", async () => {
    mocks.generate.mockRejectedValue(new Error("boom"));
    const { statuses, done } = await collect(await POST(photoRequest({ file: await photoFile() })));
    expect(statuses).toEqual([
      "Förbereder uppladdad bild",
      "Ritar om planritningen",
      "Slutför konverteringen",
      "Sätter ram och logotyp",
      "Sparar planritning",
    ]);
    expect(done.engine).toBe("algorithm");
  });

  it("fails with a Swedish message when Supabase is not configured", async () => {
    mocks.supabase = null;
    await expect(collect(await POST(photoRequest({ file: await photoFile() })))).rejects.toThrow(
      "Serverkonfiguration saknas.",
    );
  });
});

describe("parseSourceImageId", () => {
  it("reads the id the way the form field always was", async () => {
    const { parseSourceImageId } = await import("@/lib/floorplan/run-conversion");
    expect(parseSourceImageId("7")).toBe(7);
    expect(parseSourceImageId(" 7 ")).toBe(7);
    expect(parseSourceImageId(7)).toBe(7);
    expect(parseSourceImageId("")).toBeNull();
    expect(parseSourceImageId("   ")).toBeNull();
    expect(parseSourceImageId("abc")).toBeNull();
    expect(parseSourceImageId(null)).toBeNull();
    expect(parseSourceImageId(undefined)).toBeNull();
    expect(parseSourceImageId(Number.NaN)).toBeNull();
    expect(parseSourceImageId(new File(["x"], "x.png"))).toBeNull();
  });
});

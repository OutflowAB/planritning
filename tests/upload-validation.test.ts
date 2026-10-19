import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { readJsonCapped } from "@/lib/http";
import { validateImageUpload } from "@/lib/image/validate-upload";

describe("readJsonCapped", () => {
  it("reads a body within the limit and refuses one over it", async () => {
    const small = await readJsonCapped<{ a: number }>(new Request("http://x", { method: "POST", body: '{"a":1}' }), 100);
    expect(small).toEqual({ ok: true, data: { a: 1 } });

    const large = await readJsonCapped(new Request("http://x", { method: "POST", body: `"${"x".repeat(200)}"` }), 100);
    expect(large.ok).toBe(false);
    if (!large.ok) expect(large.response.status).toBe(413);

    const broken = await readJsonCapped(new Request("http://x", { method: "POST", body: "{nope" }), 100);
    if (!broken.ok) expect(broken.response.status).toBe(400);
    expect(await readJsonCapped(new Request("http://x", { method: "POST" }), 100)).toEqual({ ok: true, data: {} });
  });
});

describe("validateImageUpload", () => {
  it("accepts a real PNG whatever the browser called it, and stores it as PNG", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
    const result = await validateImageUpload(new File([new Uint8Array(png)], "plan.jpg", { type: "image/jpeg" }));
    expect(result).toMatchObject({ ok: true, mimeType: "image/png", extension: "png" });
  });

  it("refuses an SVG even when it claims to be a PNG", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script></svg>';
    const result = await validateImageUpload(new File([svg], "plan.png", { type: "image/png" }));
    expect(result).toMatchObject({ ok: false, status: 415 });
  });
});

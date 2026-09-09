import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, describeError } from "@/lib/api-client";
import { imageUrl } from "@/lib/image-url";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body?: unknown) {
  vi.stubGlobal("fetch", async () =>
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
}

describe("apiFetch", () => {
  it("returns the response when ok", async () => {
    stubFetch(200, { ok: true });
    const response = await apiFetch("/x");
    expect(response.status).toBe(200);
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not-found"],
    [500, "server"],
  ] as const)("maps %i to %s", async (status, kind) => {
    vi.stubGlobal("window", undefined);
    stubFetch(status, { message: "från servern" });
    await expect(apiFetch("/x")).rejects.toMatchObject({ kind, status, message: "från servern" });
  });

  it("falls back to a readable message when the body has none", async () => {
    stubFetch(500);
    const error = await apiFetch("/x").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toMatch(/servern/);
  });

  it("turns a dropped connection into a network error", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(apiFetch("/x")).rejects.toMatchObject({ kind: "network" });
  });

  it("lets an abort through untouched, and describeError hides it", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const error = await apiFetch("/x").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DOMException);
    expect(describeError(error, "fallback")).toBeNull();
  });
});

describe("imageUrl", () => {
  it("includes the version only when there is one", () => {
    expect(imageUrl(5, "thumb", "abc")).toBe("/api/image?id=5&variant=thumb&v=abc");
    expect(imageUrl(5, "full", null)).toBe("/api/image?id=5&variant=full");
  });
});

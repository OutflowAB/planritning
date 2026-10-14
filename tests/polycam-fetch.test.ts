import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchRoomplan,
  isAllowedStorageUrl,
  MAX_ROOMPLAN_BYTES,
  PolycamError,
} from "@/lib/polycam/fetch-roomplan";

const ID = "FA402246-4F1C-48EA-886A-C4E773CD7E4E";
const API_URL = `https://poly.cam/api/capture/${ID}/artifacts/optimized_roomplan.json`;
const STORAGE_URL = "https://abc123.r2.cloudflarestorage.com/captures/x.json?X-Amz-Signature=s";
const SPACES_URL = "https://polycam.nyc3.digitaloceanspaces.com/captures/x.json?sig=s";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function redirectTo(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PolycamError);
    expect((error as PolycamError).message).toMatch(/[åäö]|Polycam/);
    return (error as PolycamError).code;
  }
  throw new Error("expected a PolycamError");
}

describe("fetchRoomplan", () => {
  it("follows Polycam's redirect to its storage and parses the file", async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo(STORAGE_URL))
      .mockResolvedValueOnce(json({ walls: [] }));

    await expect(fetchRoomplan(ID)).resolves.toEqual({ walls: [] });

    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(String(firstUrl)).toBe(API_URL);
    expect(firstInit).toMatchObject({ redirect: "manual", credentials: "omit", cache: "no-store" });
    const [secondUrl, secondInit] = fetchMock.mock.calls[1];
    expect(String(secondUrl)).toBe(STORAGE_URL);
    expect(secondInit).toMatchObject({ redirect: "error", credentials: "omit" });
  });

  it("accepts the DigitalOcean storage host too", async () => {
    fetchMock.mockResolvedValueOnce(redirectTo(SPACES_URL, 307)).mockResolvedValueOnce(json({}));
    await expect(fetchRoomplan(ID)).resolves.toEqual({});
  });

  it.each([
    ["another host", "https://evil.example.com/x.json"],
    ["a lookalike suffix", "https://r2.cloudflarestorage.com.evil.com/x.json"],
    ["the bare suffix", "https://r2.cloudflarestorage.com/x.json"],
    ["a suffix without the dot", "https://evilr2.cloudflarestorage.com/x.json"],
    ["plain http", "http://abc.r2.cloudflarestorage.com/x.json"],
    ["an internal address", "https://169.254.169.254/latest/meta-data"],
    ["localhost", "https://localhost/x.json"],
    ["a non-standard port", "https://abc.r2.cloudflarestorage.com:8443/x.json"],
    ["userinfo", "https://user@abc.r2.cloudflarestorage.com/x.json"],
    ["poly.cam itself (a loop)", API_URL],
    ["a relative location", "/api/capture/other"],
    ["a file URL", "file:///etc/passwd"],
  ])("refuses a redirect to %s", async (_label, location) => {
    fetchMock.mockResolvedValueOnce(redirectTo(location));
    expect(await codeOf(fetchRoomplan(ID))).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect without a location", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    expect(await codeOf(fetchRoomplan(ID))).toBe("unavailable");
  });

  it("does not follow a second redirect from storage", async () => {
    fetchMock.mockResolvedValueOnce(redirectTo(STORAGE_URL)).mockImplementationOnce(async (_url, init) => {
      // What undici does with redirect: "error" when the response is a redirect.
      expect(init?.redirect).toBe("error");
      throw new TypeError("fetch failed: unexpected redirect");
    });
    expect(await codeOf(fetchRoomplan(ID))).toBe("unavailable");
  });

  it("maps 403 to a private link", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Missing Authorization header" }, { status: 403 }));
    expect(await codeOf(fetchRoomplan(ID))).toBe("private");
  });

  it("maps 404 to a capture without a floor plan, before or after the redirect", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    expect(await codeOf(fetchRoomplan(ID))).toBe("missing");

    fetchMock
      .mockResolvedValueOnce(redirectTo(STORAGE_URL))
      .mockResolvedValueOnce(new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 }));
    expect(await codeOf(fetchRoomplan(ID))).toBe("missing");
  });

  it("maps a server error to a generic failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    expect(await codeOf(fetchRoomplan(ID))).toBe("unavailable");
  });

  it("caps the body even when Content-Length claims it is small", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    fetchMock
      .mockResolvedValueOnce(redirectTo(STORAGE_URL))
      .mockResolvedValueOnce(new Response(body, { status: 200, headers: { "content-length": "10" } }));

    expect(await codeOf(fetchRoomplan(ID))).toBe("invalid");
    // It stopped reading right after the limit rather than draining an endless stream.
    expect(sent).toBeLessThanOrEqual(MAX_ROOMPLAN_BYTES + 2 * chunk.byteLength);
  });

  it("accepts a file right at the cap", async () => {
    const text = JSON.stringify({ pad: "x".repeat(MAX_ROOMPLAN_BYTES - 20) });
    expect(text.length).toBeLessThanOrEqual(MAX_ROOMPLAN_BYTES);
    fetchMock.mockResolvedValueOnce(redirectTo(STORAGE_URL)).mockResolvedValueOnce(new Response(text));
    await expect(fetchRoomplan(ID)).resolves.toHaveProperty("pad");
  });

  it("rejects malformed JSON", async () => {
    fetchMock.mockResolvedValueOnce(redirectTo(STORAGE_URL)).mockResolvedValueOnce(new Response("{walls:"));
    expect(await codeOf(fetchRoomplan(ID))).toBe("invalid");
  });

  it("gives up after the timeout", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const startedAt = Date.now();
    expect(await codeOf(fetchRoomplan(ID, { timeoutMs: 50 }))).toBe("unavailable");
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("passes a caller abort through as an abort", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const controller = new AbortController();
    const pending = fetchRoomplan(ID, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.not.toBeInstanceOf(PolycamError);
  });

  it("never builds a URL from an id that is not an upper-case UUID", async () => {
    for (const id of ["../../x", ID.toLowerCase(), `${ID}/../x`, ""]) {
      expect(await codeOf(fetchRoomplan(id))).toBe("private");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("isAllowedStorageUrl", () => {
  it("allows only the storage hosts over https", () => {
    expect(isAllowedStorageUrl(new URL(STORAGE_URL))).toBe(true);
    expect(isAllowedStorageUrl(new URL(SPACES_URL))).toBe(true);
    expect(isAllowedStorageUrl(new URL("https://polycam.nyc3.digitaloceanspaces.com.evil.com/"))).toBe(false);
    expect(isAllowedStorageUrl(new URL("https://other.nyc3.digitaloceanspaces.com/"))).toBe(false);
  });
});

/**
 * Downloads the floor-plan data of a public Polycam capture.
 *
 * This depends on an undocumented endpoint: `poly.cam/api/capture/{id}/artifacts/...` is what
 * Polycam's own share page uses, not a published API, and it can change without notice. Every
 * failure therefore has to end in a clear Swedish message rather than a crash, and the route
 * keeps working for photo uploads regardless.
 *
 * Only `optimized_roomplan.json` (Apple RoomPlan output, ~50 kB) is fetched. The larger raw
 * `roomplan.json` is not used as a fallback: a capture without the optimized file has, in
 * every case seen so far, no floor plan at all.
 */

export type PolycamErrorCode = "private" | "missing" | "unavailable" | "invalid";

const MESSAGES: Record<PolycamErrorCode, string> = {
  private:
    "Polycam-länken är privat eller felaktig. Dela skanningen som publik länk i Polycam och försök igen.",
  missing:
    "Skanningen saknar planritning. Länken måste gå till en LiDAR-skanning gjord i Polycams rums- eller planritningsläge.",
  unavailable: "Kunde inte hämta skanningen från Polycam. Försök igen om en stund.",
  invalid: "Planritningen från Polycam kunde inte läsas.",
};

/** A Polycam failure carrying a message written for the user. */
export class PolycamError extends Error {
  readonly code: PolycamErrorCode;

  constructor(code: PolycamErrorCode, message = MESSAGES[code]) {
    super(message);
    this.name = "PolycamError";
    this.code = code;
  }
}

const API_ORIGIN = "https://poly.cam";
const ROOMPLAN_ARTIFACT = "optimized_roomplan.json";

/**
 * Where Polycam's API is allowed to send us. It answers with a 302 to a presigned URL on its
 * object storage; anything else is refused, so a compromised or changed redirect cannot point
 * the server at an internal address.
 */
export const ALLOWED_STORAGE_HOSTS = {
  exact: ["polycam.nyc3.digitaloceanspaces.com"],
  suffixes: [".r2.cloudflarestorage.com"],
} as const;

/** Whole download, both hops and the body. The real file arrives in well under a second. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** About a hundred times the size of a real apartment scan. */
export const MAX_ROOMPLAN_BYTES = 5 * 1024 * 1024;

const CAPTURE_ID_PATTERN = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

export function isAllowedStorageUrl(url: URL) {
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return false;
  }

  const host = url.hostname;
  return (
    ALLOWED_STORAGE_HOSTS.exact.some((allowed) => host === allowed) ||
    ALLOWED_STORAGE_HOSTS.suffixes.some(
      (suffix) => host.endsWith(suffix) && host.length > suffix.length,
    )
  );
}

/** Reads at most `limit` bytes. Content-Length is not trusted: it can be absent or wrong. */
async function readCapped(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new PolycamError("invalid");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new PolycamError("invalid");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function failureForStatus(status: number): PolycamError {
  if (status === 401 || status === 403) {
    return new PolycamError("private");
  }
  if (status === 404) {
    return new PolycamError("missing");
  }
  return new PolycamError("unavailable");
}

export type FetchRoomplanOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Returns the parsed JSON of a capture's floor plan. It is untrusted data: the caller must
 * validate its shape before using any of it.
 */
export async function fetchRoomplan(
  captureId: string,
  { signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS }: FetchRoomplanOptions = {},
): Promise<unknown> {
  // The id is interpolated into a URL path, so it is checked here too rather than trusted to
  // have come through the link parser.
  if (!CAPTURE_ID_PATTERN.test(captureId)) {
    throw new PolycamError("private");
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const apiUrl = `${API_ORIGIN}/api/capture/${captureId}/artifacts/${ROOMPLAN_ARTIFACT}`;
  // No cookies, no caching, nothing that identifies the user: these are anonymous reads of a
  // public file.
  const baseInit: RequestInit = {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  };

  try {
    const first = await fetch(apiUrl, { ...baseInit, redirect: "manual" });
    let fileResponse = first;

    if (first.status >= 300 && first.status < 400) {
      await first.body?.cancel().catch(() => {});
      const location = first.headers.get("location");
      let target: URL | null = null;
      try {
        target = location ? new URL(location, apiUrl) : null;
      } catch {
        target = null;
      }

      if (!target || !isAllowedStorageUrl(target)) {
        console.warn(
          `Polycam redirect refused ${JSON.stringify({ captureId, host: target?.host ?? null })}`,
        );
        throw new PolycamError("unavailable");
      }

      // One hop only: the storage URL is presigned and final, so a second redirect is refused
      // outright instead of being checked against the allowlist again.
      fileResponse = await fetch(target, { ...baseInit, redirect: "error" });
    }

    if (fileResponse.status !== 200) {
      await fileResponse.body?.cancel().catch(() => {});
      console.warn(`Polycam download failed ${JSON.stringify({ captureId, status: fileResponse.status })}`);
      throw failureForStatus(fileResponse.status);
    }

    const text = await readCapped(fileResponse, MAX_ROOMPLAN_BYTES);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new PolycamError("invalid");
    }
  } catch (error) {
    if (error instanceof PolycamError) {
      throw error;
    }
    // The user went away; let the route see the abort as an abort.
    if (callerSignal?.aborted) {
      throw error;
    }
    console.warn(
      `Polycam download error ${JSON.stringify({
        captureId,
        reason: error instanceof Error ? error.name : "unknown",
      })}`,
    );
    throw new PolycamError("unavailable");
  }
}

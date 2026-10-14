/**
 * Reads a Polycam share link and returns only the capture id.
 *
 * The pasted text is never fetched. The server builds every Polycam URL itself from the id
 * returned here, so this parser only has to answer "is this unmistakably a poly.cam capture
 * link, and which capture?" — anything looser would be the first step of an SSRF.
 */

const POLYCAM_HOST = "poly.cam";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The title slug Polycam appends to explore links, e.g. "Sep-21-0850-AM". */
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

/** Longer than any real share link; stops pathological input before the URL parser sees it. */
const MAX_INPUT_LENGTH = 500;

/**
 * Accepts `https://poly.cam/capture/{id}` and the `https://poly.cam/explore/capture/{id}/{slug}`
 * form Polycam uses in its own page metadata, each with an optional trailing slash. Query and
 * fragment are ignored since only the id is used. Returns the id in upper case, which is how
 * Polycam's API expects it, or null for anything else.
 */
export function parsePolycamCaptureId(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INPUT_LENGTH) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // Exact host only: endsWith would let "evilpoly.cam" through, and the URL parser has
  // already lower-cased the host and turned an IP into its canonical form, neither of which
  // can equal "poly.cam".
  if (
    url.protocol !== "https:" ||
    url.hostname !== POLYCAM_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }

  const segments = url.pathname.replace(/\/$/, "").split("/").slice(1);
  let id: string | undefined;

  if (segments.length === 2 && segments[0] === "capture") {
    id = segments[1];
  } else if (
    (segments.length === 3 || segments.length === 4) &&
    segments[0] === "explore" &&
    segments[1] === "capture" &&
    (segments.length === 3 || SLUG_PATTERN.test(segments[3]))
  ) {
    id = segments[2];
  }

  return id && UUID_PATTERN.test(id) ? id.toUpperCase() : null;
}

/** The canonical share link for a capture, rebuilt from the id rather than the pasted text. */
export function polycamCaptureUrl(captureId: string) {
  return `https://${POLYCAM_HOST}/capture/${captureId}`;
}

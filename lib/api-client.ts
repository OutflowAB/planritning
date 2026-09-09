"use client";

import { clearStoredAuth } from "@/lib/auth-session";

/**
 * One place that turns an HTTP response into something the UI can act on. The pages used to
 * inspect `response.ok` and fall back to a generic message, which made an expired session,
 * a missing image and a dropped connection all look the same.
 */

export type ApiErrorKind = "unauthenticated" | "forbidden" | "not-found" | "network" | "server";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;

  constructor(kind: ApiErrorKind, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

const FALLBACK_MESSAGES: Record<ApiErrorKind, string> = {
  unauthenticated: "Du är utloggad. Logga in igen.",
  forbidden: "Saknar behörighet för den här åtgärden.",
  "not-found": "Det du sökte finns inte längre.",
  network: "Ingen kontakt med servern. Kontrollera uppkopplingen och försök igen.",
  server: "Något gick fel på servern. Försök igen om en stund.",
};

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  return "server";
}

async function readMessage(response: Response): Promise<string | null> {
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    return typeof data.message === "string" && data.message.length > 0 ? data.message : null;
  } catch {
    return null;
  }
}

function redirectToLogin() {
  if (typeof window === "undefined") {
    return;
  }

  clearStoredAuth();
  // A hard navigation: the guard components read auth from localStorage on mount, and a
  // router.replace from here would keep the now-stale page tree alive around them.
  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}

/**
 * `fetch` that throws `ApiError` for every failure and signs the user out on 401. Network
 * failures — including a request aborted by navigation — surface as `network`, and the
 * caller decides whether that deserves a message.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, { credentials: "same-origin", ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError("network", 0, FALLBACK_MESSAGES.network);
  }

  if (response.ok) {
    return response;
  }

  const kind = kindForStatus(response.status);
  const message = (await readMessage(response)) ?? FALLBACK_MESSAGES[kind];

  if (kind === "unauthenticated") {
    redirectToLogin();
  }

  throw new ApiError(kind, response.status, message);
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, init);
  return (await response.json()) as T;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Message to show for an error, or null when the request was simply abandoned. */
export function describeError(error: unknown, fallback: string): string | null {
  if (isAbortError(error)) {
    return null;
  }
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

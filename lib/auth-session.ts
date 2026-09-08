import { AUTH_ROLE_STORAGE_KEY, AUTH_STORAGE_KEY } from "@/lib/auth";

/**
 * Shared session verification.
 *
 * Every section has its own layout, so moving between them remounts the route guard. Without
 * a shared result each navigation fired its own `/api/auth/session` request and blocked the
 * page behind it. Caching the answer for a short while — and sharing an in-flight request —
 * makes the check free on every navigation after the first.
 */

const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedSession = {
  role: string | null;
  checkedAt: number;
};

let cachedSession: CachedSession | null = null;
let inFlight: Promise<string | null> | null = null;

export function readCachedSessionRole(): string | null | undefined {
  if (!cachedSession) {
    return undefined;
  }

  if (Date.now() - cachedSession.checkedAt > SESSION_CACHE_TTL_MS) {
    cachedSession = null;
    return undefined;
  }

  return cachedSession.role;
}

export function clearSessionCache() {
  cachedSession = null;
  inFlight = null;
}

/**
 * Resolves the role the server recognises, or null when the session is gone. A network
 * failure resolves to `undefined` so callers can tell "signed out" from "could not ask".
 */
export async function verifySessionRole(): Promise<string | null | undefined> {
  const cached = readCachedSessionRole();
  if (cached !== undefined) {
    return cached;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const response = await fetch("/api/auth/session", { credentials: "include" });
      const data = (await response.json()) as { role?: string | null };
      const role = data.role ?? null;
      cachedSession = { role, checkedAt: Date.now() };
      return role;
    } finally {
      inFlight = null;
    }
  })();

  try {
    return await inFlight;
  } catch {
    return undefined;
  }
}

/** Wipes the local auth flags without importing the setter's default-role behaviour. */
export function clearStoredAuth() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_ROLE_STORAGE_KEY);
  clearSessionCache();
}

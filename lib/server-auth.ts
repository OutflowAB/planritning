import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { UserRole } from "@/lib/auth";

/**
 * Signed session cookie.
 *
 * The cookie used to hold the bare role, so anyone could type `sm_auth_role=admin` into
 * devtools and pass every server-side check. It now carries `v1.<role>.<expiresAt>.<hmac>`,
 * verified in constant time. Old plaintext cookies fail verification, which signs those
 * sessions out once — the intended outcome.
 */

export const SESSION_COOKIE_NAME = "sm_auth_role";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const SESSION_VERSION = "v1";

function sessionSecret(): Buffer {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit) {
    return Buffer.from(explicit, "utf8");
  }

  // Derived rather than reused: the service-role key never leaves this function's input, and
  // rotating AUTH_SECRET later changes the derived key without touching Supabase.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error("AUTH_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set to sign sessions.");
  }

  return createHmac("sha256", serviceRoleKey).update("sm-planritning-session").digest();
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

export function createSessionCookieValue(role: UserRole, ttlSeconds = SESSION_TTL_SECONDS) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = `${SESSION_VERSION}.${role}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function readSessionRole(cookieValue: string | undefined): UserRole | null {
  if (!cookieValue) {
    return null;
  }

  const parts = cookieValue.split(".");
  if (parts.length !== 4 || parts[0] !== SESSION_VERSION) {
    return null;
  }

  const [version, role, expiresAtRaw, signature] = parts;
  if (role !== "admin" && role !== "user") {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  const expected = sign(`${version}.${role}.${expiresAtRaw}`);
  const given = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return null;
  }

  return role;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function getRequestRole(): Promise<UserRole | null> {
  const cookieStore = await cookies();
  return readSessionRole(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

type RoleCheck =
  | { ok: true; role: UserRole }
  | { ok: false; response: NextResponse };

/**
 * Gate for API routes. 401 means "no valid session" and the client should sign the user out;
 * 403 means "signed in, but not allowed" and the client should not. Keeping the two apart is
 * what lets the frontend tell an expired session from a permissions problem.
 */
export async function requireRole(minimumRole: UserRole = "user"): Promise<RoleCheck> {
  const role = await getRequestRole();

  if (!role) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Du är utloggad. Logga in igen.", code: "unauthenticated" },
        { status: 401 },
      ),
    };
  }

  if (minimumRole === "admin" && role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Saknar behörighet för den här åtgärden.", code: "forbidden" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, role };
}

/** Constant-time string comparison for credentials. */
export function credentialsMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Compare anyway so the branch does not leak length via timing.
    timingSafeEqual(b, b);
    return false;
  }

  return timingSafeEqual(a, b);
}

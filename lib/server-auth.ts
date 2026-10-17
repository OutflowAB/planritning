import { createHmac, timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { UserRole } from "@/lib/auth";
import { getAdminSupabase } from "@/lib/supabase-server";

/**
 * Signed session cookie: `v2.<userId>.<sessionVersion>.<expiresAt>.<hmac>`, verified in
 * constant time. Who the user is and what they may do is read from their `profiles` row on
 * every request, so disabling a user or bumping their session version signs them out
 * everywhere at once. Cookies from the old shared login (v1) fail verification.
 */

export const SESSION_COOKIE_NAME = "sm_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const COOKIE_FORMAT = "v2";

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

export type SessionClaims = { userId: string; sessionVersion: number };

export function createSessionCookieValue(
  userId: string,
  sessionVersion: number,
  ttlSeconds = SESSION_TTL_SECONDS,
) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = `${COOKIE_FORMAT}.${userId}.${sessionVersion}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function readSessionCookie(cookieValue: string | undefined): SessionClaims | null {
  if (!cookieValue) {
    return null;
  }

  const parts = cookieValue.split(".");
  if (parts.length !== 5 || parts[0] !== COOKIE_FORMAT) {
    return null;
  }

  const [format, userId, versionRaw, expiresAtRaw, signature] = parts;
  const sessionVersion = Number(versionRaw);
  const expiresAt = Number(expiresAtRaw);
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !Number.isInteger(sessionVersion)) {
    return null;
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  const expected = sign(`${format}.${userId}.${versionRaw}.${expiresAtRaw}`);
  const given = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return null;
  }

  return { userId, sessionVersion };
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export type Session = {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  isAdmin: boolean;
  mustChangePassword: boolean;
  sessionVersion: number;
};

export type ProfileRow = {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  must_change_password: boolean;
  disabled: boolean;
  session_version: number;
  created_at: string;
};

export const PROFILES_TABLE = "profiles";
export const PROFILE_COLUMNS =
  "id, email, display_name, role, must_change_password, disabled, session_version, created_at";

export function sessionFromProfile(profile: ProfileRow): Session {
  return {
    userId: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    isAdmin: profile.role === "admin",
    mustChangePassword: profile.must_change_password,
    sessionVersion: profile.session_version,
  };
}

/** The signed-in user, or null when the cookie is missing, forged, expired or revoked. */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const claims = readSessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  const supabase = getAdminSupabase();
  if (!claims || !supabase) {
    return null;
  }

  const { data } = await supabase
    .from(PROFILES_TABLE)
    .select(PROFILE_COLUMNS)
    .eq("id", claims.userId)
    .maybeSingle<ProfileRow>();

  if (!data || data.disabled || data.session_version !== claims.sessionVersion) {
    return null;
  }
  return sessionFromProfile(data);
}

export type SessionCheck = ({ ok: true } & Session) | { ok: false; response: NextResponse };

type SessionOptions = { role?: UserRole; allowPendingPassword?: boolean; allowDev?: boolean };

/**
 * Whether an account of this role may use a route. A route that names a role is for that role
 * only. The developer account sees spending and usage and nothing else, so it is turned away
 * from every other route unless the route says `allowDev` (changing its own password).
 */
export function roleMayUse(role: UserRole, options: Pick<SessionOptions, "role" | "allowDev">): boolean {
  if (options.role) return role === options.role;
  return role !== "dev" || options.allowDev === true;
}

/**
 * Gate for API routes. 401 means "no valid session" and the client signs the user out; 403
 * means "signed in, but not allowed". A user with a temporary password gets 403
 * `password_change_required` everywhere except the routes that let them change it.
 */
export async function requireSession(options: SessionOptions = {}): Promise<SessionCheck> {
  const session = await getSession();

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Du är utloggad. Logga in igen.", code: "unauthenticated" },
        { status: 401 },
      ),
    };
  }

  if (session.mustChangePassword && !options.allowPendingPassword) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Byt ditt tillfälliga lösenord först.", code: "password_change_required" },
        { status: 403 },
      ),
    };
  }

  if (!roleMayUse(session.role, options)) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Saknar behörighet för den här åtgärden.", code: "forbidden" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, ...session };
}

export function setSessionCookie(response: NextResponse, userId: string, sessionVersion: number) {
  response.cookies.set(SESSION_COOKIE_NAME, createSessionCookieValue(userId, sessionVersion), {
    ...sessionCookieOptions,
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions, maxAge: 0 });
  return response;
}

// Failed sign-ins allowed within the window before further tries are refused.
export const LOGIN_WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 30;

export function isThrottled(failures: { email: number; ip: number }) {
  return failures.email >= MAX_FAILURES_PER_EMAIL || failures.ip >= MAX_FAILURES_PER_IP;
}

/** At least 10 characters: long enough to resist guessing, short enough to type. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Lösenordet måste vara minst 10 tecken.";
  if (password.length > 200) return "Lösenordet är för långt.";
  return null;
}

/**
 * Checks a password against Supabase Auth without touching the shared server client: a
 * sign-in swaps the client's token for the user's, which would put every later query under
 * row-level security. A throwaway client per attempt keeps the shared one on the service role.
 */
export async function verifyPassword(email: string, password: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return error || !data.user ? null : data.user.id;
}

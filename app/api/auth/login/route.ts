import { NextResponse } from "next/server";

import type { UserRole } from "@/lib/auth";
import {
  createSessionCookieValue,
  credentialsMatch,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from "@/lib/server-auth";

type LoginBody = {
  email?: string;
  password?: string;
};

function clearedSession(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions, maxAge: 0 });
  return response;
}

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  const userEmail = process.env.ADMIN_EMAIL;
  const userPassword = process.env.ADMIN_PASSWORD;
  const adminEmail = process.env.SUPERADMIN_EMAIL;
  const adminPassword = process.env.SUPERADMIN_PASSWORD;

  if (!userEmail || !userPassword) {
    return clearedSession(
      NextResponse.json({ message: "Serverkonfiguration saknas." }, { status: 500 }),
    );
  }

  let role: UserRole | null = null;

  if (
    adminEmail &&
    adminPassword &&
    credentialsMatch(email, adminEmail) &&
    credentialsMatch(password, adminPassword)
  ) {
    role = "admin";
  } else if (credentialsMatch(email, userEmail) && credentialsMatch(password, userPassword)) {
    role = "user";
  }

  if (!role) {
    return clearedSession(
      NextResponse.json({ message: "Fel e-post eller lösenord." }, { status: 401 }),
    );
  }

  const response = NextResponse.json({ success: true, role });
  response.cookies.set(SESSION_COOKIE_NAME, createSessionCookieValue(role), {
    ...sessionCookieOptions,
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

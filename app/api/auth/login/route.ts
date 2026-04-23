import { NextResponse } from "next/server";

import type { UserRole } from "@/lib/auth";

type LoginBody = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as LoginBody;
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  const userEmail = process.env.ADMIN_EMAIL;
  const userPassword = process.env.ADMIN_PASSWORD;
  const adminEmail = process.env.SUPERADMIN_EMAIL;
  const adminPassword = process.env.SUPERADMIN_PASSWORD;

  if (!userEmail || !userPassword) {
    const response = NextResponse.json(
      { message: "Serverkonfiguration saknas." },
      { status: 500 },
    );
    response.cookies.set("sm_auth_role", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  let role: UserRole | null = null;

  if (email === adminEmail && password === adminPassword) {
    role = "admin";
  } else if (email === userEmail && password === userPassword) {
    role = "user";
  }

  if (role) {
    const response = NextResponse.json({ success: true, role });
    response.cookies.set("sm_auth_role", role, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  }

  const response = NextResponse.json(
    { message: "Fel e-post eller lösenord." },
    { status: 401 },
  );
  response.cookies.set("sm_auth_role", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

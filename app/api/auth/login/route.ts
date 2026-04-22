import { NextResponse } from "next/server";

type LoginBody = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as LoginBody;
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    return NextResponse.json(
      { message: "Serverkonfiguration saknas." },
      { status: 500 },
    );
  }

  if (email === adminEmail && password === adminPassword) {
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { message: "Fel e-post eller lösenord." },
    { status: 401 },
  );
}

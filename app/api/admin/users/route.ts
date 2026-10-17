import { NextResponse } from "next/server";

import { temporaryPassword } from "@/lib/temporary-password";
import { PROFILE_COLUMNS, PROFILES_TABLE, type ProfileRow, requireSession } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const session = await requireSession({ role: "admin" });
  if (!session.ok) return session.response;
  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .select(PROFILE_COLUMNS)
    .neq("role", "dev")
    .order("display_name")
    .returns<ProfileRow[]>();
  if (error) {
    return NextResponse.json({ message: "Kunde inte hämta användare." }, { status: 500 });
  }
  return NextResponse.json({ users: data ?? [] });
}

type CreateBody = { email?: string; displayName?: string; role?: string };

export async function POST(request: Request) {
  const session = await requireSession({ role: "admin" });
  if (!session.ok) return session.response;
  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const displayName = body.displayName?.trim() ?? "";
  const role = body.role === "admin" ? "admin" : "user";
  if (!EMAIL_PATTERN.test(email) || email.length > 200) {
    return NextResponse.json({ message: "Ange en giltig e-postadress." }, { status: 400 });
  }
  if (!displayName || displayName.length > 100) {
    return NextResponse.json({ message: "Ange ett namn." }, { status: 400 });
  }

  const password = temporaryPassword();
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    const taken = createError?.message.toLowerCase().includes("already");
    return NextResponse.json(
      { message: taken ? "E-postadressen används redan." : "Kunde inte skapa användaren." },
      { status: taken ? 409 : 500 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from(PROFILES_TABLE)
    .insert({ id: created.user.id, email, display_name: displayName, role })
    .select(PROFILE_COLUMNS)
    .single<ProfileRow>();
  if (profileError || !profile) {
    // No half-made accounts: without a profile the user could not sign in anyway.
    await supabase.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ message: "Kunde inte skapa användaren." }, { status: 500 });
  }

  return NextResponse.json({ user: profile, temporaryPassword: password });
}

import { NextResponse } from "next/server";

import {
  clearSessionCookie,
  isThrottled,
  LOGIN_WINDOW_MINUTES,
  PROFILE_COLUMNS,
  PROFILES_TABLE,
  type ProfileRow,
  setSessionCookie,
  verifyPassword,
} from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

type LoginBody = {
  email?: string;
  password?: string;
};

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  const supabase = getAdminSupabase();
  if (!supabase) {
    return serverConfigMissingResponse();
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const ip = clientIp(request);
  if (!email || !password) {
    return NextResponse.json({ message: "Fyll i e-post och lösenord." }, { status: 400 });
  }

  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
  const [byEmail, byIp] = await Promise.all([
    supabase.from("login_attempts").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", since),
    supabase.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since),
  ]);
  if (isThrottled({ email: byEmail.count ?? 0, ip: byIp.count ?? 0 })) {
    return NextResponse.json(
      { message: `För många misslyckade försök. Vänta ${LOGIN_WINDOW_MINUTES} minuter.` },
      { status: 429 },
    );
  }

  const userId = await verifyPassword(email, password);
  const { data: profile } = userId
    ? await supabase.from(PROFILES_TABLE).select(PROFILE_COLUMNS).eq("id", userId).maybeSingle<ProfileRow>()
    : { data: null };

  if (!profile || profile.disabled) {
    await supabase.from("login_attempts").insert({ email, ip });
    return clearSessionCookie(
      NextResponse.json({ message: "Fel e-post eller lösenord." }, { status: 401 }),
    );
  }

  await supabase.from("login_attempts").delete().eq("email", email);
  const response = NextResponse.json({
    success: true,
    role: profile.role,
    mustChangePassword: profile.must_change_password,
    displayName: profile.display_name,
  });
  return setSessionCookie(response, profile.id, profile.session_version);
}

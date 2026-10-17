import { NextResponse } from "next/server";

import {
  passwordProblem,
  PROFILES_TABLE,
  requireSession,
  setSessionCookie,
  verifyPassword,
} from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse } from "@/lib/supabase-server";

type PasswordBody = { currentPassword?: string; newPassword?: string };

/** Changes the signed-in user's password; required before anything else after a reset. */
export async function POST(request: Request) {
  const session = await requireSession({ allowPendingPassword: true });
  if (!session.ok) return session.response;

  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  let body: PasswordBody;
  try {
    body = (await request.json()) as PasswordBody;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";
  const problem = passwordProblem(newPassword);
  if (problem) return NextResponse.json({ message: problem }, { status: 400 });
  if (newPassword === currentPassword) {
    return NextResponse.json({ message: "Välj ett nytt lösenord." }, { status: 400 });
  }
  if ((await verifyPassword(session.email, currentPassword)) !== session.userId) {
    return NextResponse.json({ message: "Nuvarande lösenord stämmer inte." }, { status: 400 });
  }

  const { error } = await supabase.auth.admin.updateUserById(session.userId, { password: newPassword });
  if (error) {
    return NextResponse.json({ message: "Kunde inte byta lösenord." }, { status: 500 });
  }

  // A new session version signs out every other device that had the old password.
  const sessionVersion = session.sessionVersion + 1;
  const { error: profileError } = await supabase
    .from(PROFILES_TABLE)
    .update({ must_change_password: false, session_version: sessionVersion })
    .eq("id", session.userId);
  if (profileError) {
    return NextResponse.json({ message: "Kunde inte spara lösenordsbytet." }, { status: 500 });
  }

  return setSessionCookie(NextResponse.json({ success: true }), session.userId, sessionVersion);
}

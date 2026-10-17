import { NextResponse } from "next/server";

import { temporaryPassword } from "@/lib/temporary-password";
import { PROFILE_COLUMNS, PROFILES_TABLE, type ProfileRow, requireSession } from "@/lib/server-auth";
import { getAdminSupabase, serverConfigMissingResponse, UPLOADS_TABLE } from "@/lib/supabase-server";

type Action = "reset-password" | "disable" | "enable";

// Long enough to mean "until re-enabled".
const BAN_FOREVER = "876000h";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession({ role: "admin" });
  if (!session.ok) return session.response;
  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  const { id } = await context.params;
  if (id === session.userId) {
    return NextResponse.json({ message: "Du kan inte ändra ditt eget konto här." }, { status: 400 });
  }

  let action: Action | undefined;
  try {
    action = ((await request.json()) as { action?: Action }).action;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from(PROFILES_TABLE)
    .select(PROFILE_COLUMNS)
    .eq("id", id)
    .maybeSingle<ProfileRow>();
  // The developer account is not the superadmin's to see or change.
  if (!profile || profile.role === "dev") {
    return NextResponse.json({ message: "Användaren finns inte." }, { status: 404 });
  }

  // Every change bumps the session version, which signs the user out on all devices.
  const nextVersion = profile.session_version + 1;

  if (action === "reset-password") {
    const password = temporaryPassword();
    const { error } = await supabase.auth.admin.updateUserById(id, { password });
    if (error) return NextResponse.json({ message: "Kunde inte återställa lösenordet." }, { status: 500 });
    await supabase
      .from(PROFILES_TABLE)
      .update({ must_change_password: true, session_version: nextVersion })
      .eq("id", id);
    return NextResponse.json({ temporaryPassword: password });
  }

  if (action === "disable" || action === "enable") {
    const disabled = action === "disable";
    const { error } = await supabase.auth.admin.updateUserById(id, {
      ban_duration: disabled ? BAN_FOREVER : "none",
    });
    if (error) return NextResponse.json({ message: "Kunde inte ändra kontot." }, { status: 500 });
    await supabase.from(PROFILES_TABLE).update({ disabled, session_version: nextVersion }).eq("id", id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ message: "Okänd åtgärd." }, { status: 400 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession({ role: "admin" });
  if (!session.ok) return session.response;
  const supabase = getAdminSupabase();
  if (!supabase) return serverConfigMissingResponse();

  const { id } = await context.params;
  if (id === session.userId) {
    return NextResponse.json({ message: "Du kan inte ta bort ditt eget konto." }, { status: 400 });
  }

  // The developer account is not the superadmin's to see or change.
  const { data: target } = await supabase
    .from(PROFILES_TABLE)
    .select("role")
    .eq("id", id)
    .maybeSingle<{ role: string }>();
  if (!target || target.role === "dev") {
    return NextResponse.json({ message: "Användaren finns inte." }, { status: 404 });
  }

  // Plans and bills keep their owner, so a user with history is disabled rather than removed.
  const { count } = await supabase
    .from(UPLOADS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("owner_id", id);
  const { count: bills } = await supabase
    .from("billing_events")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", id);
  if ((count ?? 0) > 0 || (bills ?? 0) > 0) {
    return NextResponse.json(
      { message: "Användaren har planritningar eller fakturerade planer. Inaktivera i stället." },
      { status: 409 },
    );
  }

  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ message: "Kunde inte ta bort användaren." }, { status: 500 });
  return NextResponse.json({ success: true });
}

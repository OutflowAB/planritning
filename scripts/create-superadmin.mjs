// Creates the first superadmin, who then creates everyone else in Användare, or, with --dev,
// the one developer account (spending and usage only; there can be only one).
//
//   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//     node scripts/create-superadmin.mjs <email> "<namn>" [--dev]
//
// The URL and key come from the environment; this script reads no .env file itself. It prints
// a temporary password, which must be changed at the first sign-in.
import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const isDev = args.includes("--dev");
const [email, displayName] = args.filter((arg) => arg !== "--dev");
const role = isDev ? "dev" : "admin";
const label = isDev ? "Utvecklarkonto" : "Superadmin";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !displayName) {
  console.error('Användning: node scripts/create-superadmin.mjs <email> "<namn>" [--dev]');
  process.exit(1);
}
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY måste vara satta.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

if (isDev) {
  // The database allows one developer account; say so before creating anything.
  const { data: existing } = await supabase.from("profiles").select("email").eq("role", "dev").maybeSingle();
  if (existing) {
    console.error(`Det finns redan ett utvecklarkonto (${existing.email}). Det får bara finnas ett.`);
    process.exit(1);
  }
}

const password = randomBytes(9).toString("base64url");
const normalised = email.trim().toLowerCase();

const { data, error } = await supabase.auth.admin.createUser({
  email: normalised,
  password,
  email_confirm: true,
});
if (error || !data.user) {
  console.error(`Kunde inte skapa användaren: ${error?.message ?? "okänt fel"}`);
  process.exit(1);
}

const { error: profileError } = await supabase
  .from("profiles")
  .insert({ id: data.user.id, email: normalised, display_name: displayName.trim(), role });
if (profileError) {
  await supabase.auth.admin.deleteUser(data.user.id);
  console.error(`Kunde inte skapa profilen: ${profileError.message}`);
  process.exit(1);
}

console.log(`${label} ${normalised} skapad. Tillfälligt lösenord: ${password}`);

import { cookies } from "next/headers";

import type { UserRole } from "@/lib/auth";

export async function getRequestRole(): Promise<UserRole | null> {
  const cookieStore = await cookies();
  const role = cookieStore.get("sm_auth_role")?.value;
  if (role === "admin" || role === "user") {
    return role;
  }
  return null;
}

export function createUnauthorizedResponse() {
  return {
    status: 403 as const,
    body: {
      message: "Saknar behörighet. Logga ut och logga in igen.",
    },
  };
}

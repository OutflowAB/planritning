import { NextResponse } from "next/server";

import { getSession } from "@/lib/server-auth";

export async function GET() {
  const session = await getSession();
  return NextResponse.json(
    session
      ? { role: session.role, mustChangePassword: session.mustChangePassword, displayName: session.displayName }
      : { role: null },
  );
}

import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/server-auth";

export async function POST() {
  return clearSessionCookie(NextResponse.json({ success: true }));
}

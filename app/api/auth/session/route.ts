import { NextResponse } from "next/server";

import { getRequestRole } from "@/lib/server-auth";

export async function GET() {
  const role = await getRequestRole();
  return NextResponse.json({ role });
}

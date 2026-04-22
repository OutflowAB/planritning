import { NextResponse } from "next/server";

import { getFloorplanApiUrl } from "@/lib/floorplan-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const apiUrl = getFloorplanApiUrl("/upload");
  if (!apiUrl) {
    return NextResponse.json(
      { error: "Konverteringsserverns adress saknas." },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  if (!formData.get("file")) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(apiUrl, {
      method: "POST",
      body: formData,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Kunde inte nå konverteringsservern." },
      { status: 503 },
    );
  }

  const contentType =
    upstreamResponse.headers.get("content-type") ?? "application/json";
  const body = await upstreamResponse.text();

  return new Response(body, {
    status: upstreamResponse.status,
    headers: {
      "content-type": contentType,
    },
  });
}

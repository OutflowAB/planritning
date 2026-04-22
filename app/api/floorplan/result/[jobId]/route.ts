import { NextResponse } from "next/server";

import { getFloorplanApiUrl } from "@/lib/floorplan-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const apiUrl = getFloorplanApiUrl(`/result/${jobId}`);

  if (!apiUrl) {
    return NextResponse.json(
      { error: "Konverteringsserverns adress saknas." },
      { status: 500 },
    );
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(apiUrl, {
      method: "GET",
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Kunde inte nå konverteringsservern." },
      { status: 503 },
    );
  }

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    const body = await upstreamResponse.text();
    return new Response(body || "Result not ready", {
      status: upstreamResponse.status || 500,
      headers: {
        "content-type":
          upstreamResponse.headers.get("content-type") ?? "text/plain",
      },
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "content-type": upstreamResponse.headers.get("content-type") ?? "image/png",
      "cache-control": "no-store",
    },
  });
}

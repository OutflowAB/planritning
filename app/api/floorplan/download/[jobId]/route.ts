import { NextResponse } from "next/server";

import { getFloorplanApiUrl } from "@/lib/floorplan-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const requestUrl = new URL(request.url);
  const formatParam = requestUrl.searchParams.get("format");
  const formatQuery = formatParam ? `?format=${encodeURIComponent(formatParam)}` : "";
  const apiUrl = getFloorplanApiUrl(`/download/${jobId}${formatQuery}`);

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
    return new Response(body || "Download failed", {
      status: upstreamResponse.status || 500,
      headers: {
        "content-type":
          upstreamResponse.headers.get("content-type") ?? "text/plain",
      },
    });
  }

  const contentType =
    upstreamResponse.headers.get("content-type") ?? "application/octet-stream";
  const disposition =
    upstreamResponse.headers.get("content-disposition") ??
    "attachment; filename=\"floorplan_converted.png\"";

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "content-type": contentType,
      "content-disposition": disposition,
      "cache-control": "no-store",
    },
  });
}

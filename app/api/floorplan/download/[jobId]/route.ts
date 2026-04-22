import { NextResponse } from "next/server";

import { DownloadFormat, getJobDownload } from "@/lib/floorplan-jobs";

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
  const formatParam = (requestUrl.searchParams.get("format") ?? "png").toLowerCase();
  const format = ["png", "jpg", "jpeg", "webp"].includes(formatParam)
    ? (formatParam as DownloadFormat)
    : "png";

  const result = await getJobDownload(jobId, format);
  if (!result) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new Response(result.bytes, {
    status: 200,
    headers: {
      "content-type": result.contentType,
      "content-disposition": `attachment; filename="${result.fileName}"`,
      "cache-control": "no-store",
    },
  });
}

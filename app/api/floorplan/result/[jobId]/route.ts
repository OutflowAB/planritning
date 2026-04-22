import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";

import { getFloorplanJob } from "@/lib/floorplan-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = getFloorplanJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }

  if (job.status === "error") {
    return NextResponse.json(
      { error: job.error ?? "Lokal konvertering misslyckades." },
      { status: 500 },
    );
  }

  if (job.status !== "done") {
    return NextResponse.json({ error: "Result not ready" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(job.outputPath);
  } catch {
    return NextResponse.json({ error: "Result not ready" }, { status: 404 });
  }

  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
    },
  });
}

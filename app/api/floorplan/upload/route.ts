import { NextResponse } from "next/server";

import { createFloorplanJob } from "@/lib/floorplan-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedMimeTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Please use JPG, PNG, or WebP." },
      { status: 400 },
    );
  }

  const { jobId } = await createFloorplanJob(file);
  return NextResponse.json({ job_id: jobId });
}

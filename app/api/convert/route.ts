import { NextResponse } from "next/server";

import {
  createConversionStream,
  parseSourceImageId,
  runConversion,
} from "@/lib/floorplan/run-conversion";
import { requireRole } from "@/lib/server-auth";

export const runtime = "nodejs";

/** Image generation with reference images can take up to two minutes. */
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  const formData = await request.formData();
  const uploadedFile = formData.get("file");
  const sourceImageIdValue = formData.get("sourceImageId");
  const feedbackValue = formData.get("feedback");
  const feedback =
    typeof feedbackValue === "string" && feedbackValue.trim().length > 0
      ? feedbackValue.trim().slice(0, 1000)
      : undefined;

  if (!(uploadedFile instanceof File)) {
    return NextResponse.json({ message: "Ingen bildfil skickades." }, { status: 400 });
  }

  if (!uploadedFile.type.startsWith("image/")) {
    return NextResponse.json({ message: "Filen måste vara en bild." }, { status: 400 });
  }

  const inputBuffer = Buffer.from(await uploadedFile.arrayBuffer());

  return createConversionStream((send) =>
    runConversion({
      inputBuffer,
      source: {
        fileName: uploadedFile.name,
        mimeType: uploadedFile.type,
        sourceImageId: parseSourceImageId(sourceImageIdValue),
      },
      feedback,
      signal: request.signal,
      send,
    }),
  );
}

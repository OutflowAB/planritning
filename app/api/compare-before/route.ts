import { NextResponse } from "next/server";

import { buildCompareBeforeImage } from "@/lib/floorplan/build-compare-before";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploadedFile = formData.get("file");

    if (!(uploadedFile instanceof File)) {
      return NextResponse.json({ message: "Ingen bildfil skickades." }, { status: 400 });
    }

    if (!uploadedFile.type.startsWith("image/")) {
      return NextResponse.json({ message: "Filen måste vara en bild." }, { status: 400 });
    }

    const inputBuffer = Buffer.from(await uploadedFile.arrayBuffer());
    const compareBeforeBuffer = await buildCompareBeforeImage(inputBuffer);

    return new Response(new Uint8Array(compareBeforeBuffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Compare-before generation failed", error);
    return NextResponse.json({ message: "Kunde inte skapa jämförelsebilden." }, { status: 500 });
  }
}

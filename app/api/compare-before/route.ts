import sharp from "sharp";
import { NextResponse } from "next/server";

import { buildCompareBeforeImage } from "@/lib/floorplan/build-compare-before";
import type { CompareSlotLayout } from "@/lib/image/brand-floorplan";
import { requireRole } from "@/lib/server-auth";

const SLOT_KEYS = ["canvasWidth", "canvasHeight", "imageX", "imageY", "imageWidth", "imageHeight"] as const;

function parseSlot(value: FormDataEntryValue | null): CompareSlotLayout | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const slot: Partial<Record<(typeof SLOT_KEYS)[number], number>> = {};
    for (const key of SLOT_KEYS) {
      const number = Number(parsed[key]);
      if (!Number.isFinite(number) || number < 0) {
        return undefined;
      }
      slot[key] = Math.round(number);
    }
    return slot as CompareSlotLayout;
  } catch {
    return undefined;
  }
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

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
    const slot = parseSlot(formData.get("layout"));
    const compareBeforeBuffer = await buildCompareBeforeImage(inputBuffer, slot);
    const jpeg = await sharp(compareBeforeBuffer).jpeg({ quality: 85 }).toBuffer();

    return new Response(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Compare-before generation failed", error);
    return NextResponse.json({ message: "Kunde inte skapa jämförelsebilden." }, { status: 500 });
  }
}

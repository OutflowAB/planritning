import { NextResponse } from "next/server";

import { compassRotationFromScan } from "@/lib/polycam/compass";
import { fetchRoomplan, PolycamError } from "@/lib/polycam/fetch-roomplan";
import { parseRoomplan } from "@/lib/polycam/parse-roomplan";
import { listStoreys } from "@/lib/polycam/render-plan";
import { parsePolycamCaptureId } from "@/lib/polycam/url";
import { requireRole } from "@/lib/server-auth";

export const runtime = "nodejs";

export const maxDuration = 60;

const MAX_BODY_CHARS = 2_000;

/**
 * POST /api/convert-polycam/inspect  { url }  ->  { storeys: StoreySummary[], compassRotation: number | null }
 *
 * Reads the scan and reports its storeys, before any image is generated, so the user can pick
 * which floors to draw of a multi-storey house. Nothing is stored and nothing is billed.
 */
export async function POST(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  let url: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) {
      return NextResponse.json({ message: "Förfrågan är för stor." }, { status: 413 });
    }
    url = (JSON.parse(text) as { url?: unknown } | null)?.url;
  } catch {
    return NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 });
  }

  const captureId = parsePolycamCaptureId(url);
  if (!captureId) {
    return NextResponse.json(
      { message: "Klistra in en länk till en Polycam-skanning, till exempel https://poly.cam/capture/…" },
      { status: 400 },
    );
  }

  try {
    const roomplan = parseRoomplan(await fetchRoomplan(captureId, { signal: request.signal }));
    return NextResponse.json({
      storeys: listStoreys(roomplan),
      // Where north points on the sheet, so the broker can confirm or adjust it before drawing.
      compassRotation: compassRotationFromScan(roomplan.orientationDegrees, roomplan.alignment),
    });
  } catch (error) {
    if (error instanceof PolycamError) {
      return NextResponse.json({ message: error.message }, { status: 422 });
    }
    console.error("Polycam inspect failed", error);
    return NextResponse.json({ message: "Kunde inte läsa skanningen." }, { status: 500 });
  }
}

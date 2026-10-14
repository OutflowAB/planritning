import { NextResponse } from "next/server";

import {
  ConvertFailure,
  createConversionStream,
  parseSourceImageId,
  runConversion,
  type ConversionSource,
} from "@/lib/floorplan/run-conversion";
import { fetchRoomplan, PolycamError } from "@/lib/polycam/fetch-roomplan";
import { parseRoomplan } from "@/lib/polycam/parse-roomplan";
import { renderPlan } from "@/lib/polycam/render-plan";
import { parsePolycamCaptureId } from "@/lib/polycam/url";
import { requireRole } from "@/lib/server-auth";
import {
  BUCKET_NAME,
  getAdminSupabase,
  serverConfigMissingResponse,
  UPLOADS_PREFIX,
  UPLOADS_TABLE,
} from "@/lib/supabase-server";

export const runtime = "nodejs";

/** The Polycam download takes seconds; the image generation behind it up to two minutes. */
export const maxDuration = 300;

/** A link, an id and a comment. Anything larger is not a request this route makes sense of. */
const MAX_BODY_CHARS = 16_000;

function badRequest(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

/**
 * POST /api/convert-polycam  { url?, sourceImageId?, feedback? }
 *
 * Converts a public Polycam capture into a house-style floor plan. The scan is drawn as a
 * plain top-down plan, stored in uploads/ as the source image, and then run through exactly
 * the same pipeline and event stream as an uploaded photo.
 *
 * With `sourceImageId` (a redraw after a rejection) the stored plan is reused and Polycam is
 * not contacted again.
 */
export async function POST(request: Request) {
  const session = await requireRole();
  if (!session.ok) {
    return session.response;
  }

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) {
      return badRequest("Förfrågan är för stor.", 413);
    }
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return badRequest("Ogiltig förfrågan.");
  }

  const feedback =
    typeof body.feedback === "string" && body.feedback.trim().length > 0
      ? body.feedback.trim().slice(0, 1000)
      : undefined;
  const sourceImageId = parseSourceImageId(body.sourceImageId);
  const captureId = sourceImageId === null ? parsePolycamCaptureId(body.url) : null;

  if (sourceImageId === null && !captureId) {
    return badRequest(
      "Klistra in en länk till en Polycam-skanning, till exempel https://poly.cam/capture/…",
    );
  }

  const supabase = getAdminSupabase();
  if (!supabase) {
    return serverConfigMissingResponse();
  }

  let storedSource: { buffer: Buffer; source: ConversionSource } | null = null;
  if (sourceImageId !== null) {
    const { data: row, error } = await supabase
      .from(UPLOADS_TABLE)
      .select("id, file_name, file_path, mime_type")
      .eq("id", sourceImageId)
      .maybeSingle();

    // Only a stored plan can be redrawn this way: every scan source is a PNG in uploads/.
    const isStoredPlan =
      !error &&
      row &&
      typeof row.file_path === "string" &&
      row.file_path.startsWith(UPLOADS_PREFIX) &&
      row.mime_type === "image/png";
    const download = isStoredPlan
      ? await supabase.storage.from(BUCKET_NAME).download(row.file_path)
      : null;

    if (!isStoredPlan || !download?.data) {
      return badRequest("Källbilden kunde inte hittas. Klistra in Polycam-länken igen.", 404);
    }

    storedSource = {
      buffer: Buffer.from(await download.data.arrayBuffer()),
      source: { fileName: row.file_name, mimeType: "image/png", sourceImageId: row.id },
    };
  }

  return createConversionStream(async (send) => {
    let inputBuffer: Buffer;
    let source: ConversionSource;

    if (storedSource) {
      inputBuffer = storedSource.buffer;
      source = storedSource.source;
    } else {
      const id = captureId as string;
      try {
        send({ type: "status", message: "Hämtar planritningen från Polycam" });
        const roomplan = parseRoomplan(await fetchRoomplan(id, { signal: request.signal }));

        send({ type: "status", message: "Ritar upp planen" });
        const plan = await renderPlan(roomplan);
        if (plan.storyCount > 1) {
          send({
            type: "status",
            message: `Skanningen har ${plan.storyCount} våningar. Bara den första ritas.`,
          });
        }

        // Counts only: the scan's position and the presigned storage URL stay out of the logs.
        console.info(
          `Polycam plan rendered ${JSON.stringify({
            captureId: id,
            size: `${plan.width}x${plan.height}`,
            walls: plan.wallCount,
            exteriorWalls: plan.exteriorWallCount,
            droppedShortWalls: plan.droppedShortWalls,
            skippedElements: roomplan.skipped,
            story: plan.story,
            storyCount: plan.storyCount,
          })}`,
        );

        inputBuffer = plan.png;
        source = { fileName: `polycam-${id}.png`, mimeType: "image/png", sourceImageId: null };
      } catch (error) {
        if (error instanceof PolycamError) {
          throw new ConvertFailure(error.message);
        }
        throw error;
      }
    }

    await runConversion({
      inputBuffer,
      source,
      feedback,
      sourceKind: "scan",
      signal: request.signal,
      send,
    });
  });
}

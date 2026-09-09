import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  CONVERT_STREAM_CONTENT_TYPE,
  encodeSseEvent,
  type ConvertEngine,
  type ConvertStreamEvent,
} from "@/lib/floorplan/convert-stream";
import { imageDownloadFileName } from "@/lib/image-naming";
import { generateFloorplanLineArt, resolveImageEngine } from "@/lib/image/ai-floorplan";
import { measureStyleDeviation } from "@/lib/image/style-conformance";
import { isStyleReviewEnabled, reviewStyleAgainstReferences } from "@/lib/image/style-review";
import {
  buildCompareBefore,
  composeBrandedFloorplan,
  prepareSourceImage,
  sampleDominantColor,
  type Rgb,
} from "@/lib/image/brand-floorplan";
import { imageUrl } from "@/lib/image-url";
import { createThumbnail, thumbnailPath } from "@/lib/image/thumbnail";
import { requireRole } from "@/lib/server-auth";
import { getAdminSupabase, normaliseEtag } from "@/lib/supabase-server";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const GENERATED_PREFIX = "generated/";
const UPLOADS_PREFIX = "uploads/";

/**
 * How far a result may drift from the house style before it is drawn again. The six reference
 * plans score at most 8% against this measure, so 25% leaves room for legitimate variation
 * while still catching a grey background, a stray palette or an empty canvas.
 */
const DEFAULT_STYLE_DEVIATION_THRESHOLD = 0.25;

/** One retry. A second would double the wait again for diminishing odds. */
const MAX_STYLE_RETRIES = 1;

/**
 * The retry is drawn by a different model rather than re-rolling the same one. gpt-image-1.5
 * also accepts input_fidelity, which gpt-image-2 rejects, so it is a genuinely different route
 * to the same picture rather than another throw of the dice.
 */
const RETRY_IMAGE_MODEL = "gpt-image-1.5";

function resolveRetryModel() {
  return process.env.OPENAI_IMAGE_RETRY_MODEL?.trim() || RETRY_IMAGE_MODEL;
}

/**
 * The vision review needs its own, much higher bar. Measured against the approved reference
 * plans it returns 10–25% for material we know is correct, and only 35% for a deliberately
 * greyscaled and blurred one — the bands overlap, and three runs on the same image spread ten
 * points. Its number cannot carry a 25% gate. Its written observations are still worth having,
 * so they always join the corrections; the score only forces a redraw when it is unambiguous.
 */
const REVIEW_TRIGGER_THRESHOLD = 0.6;

function resolveReviewTrigger() {
  const configured = Number(process.env.STYLE_REVIEW_TRIGGER);
  if (Number.isFinite(configured) && configured > 0 && configured <= 1) {
    return configured;
  }

  return REVIEW_TRIGGER_THRESHOLD;
}

function resolveStyleThreshold() {
  const configured = Number(process.env.STYLE_DEVIATION_THRESHOLD);
  if (Number.isFinite(configured) && configured > 0 && configured <= 1) {
    return configured;
  }

  return DEFAULT_STYLE_DEVIATION_THRESHOLD;
}

export const runtime = "nodejs";

/** Image generation with reference images can take up to two minutes. */
export const maxDuration = 300;

async function resolveSourceUploadId(
  supabase: SupabaseClient,
  uploadedFile: File,
  inputBuffer: Buffer<ArrayBuffer>,
  sourceImageIdValue: FormDataEntryValue | null,
) {
  const sourceImageIdCandidate =
    typeof sourceImageIdValue === "string" && sourceImageIdValue.trim().length > 0
      ? Number(sourceImageIdValue)
      : Number.NaN;

  if (Number.isFinite(sourceImageIdCandidate)) {
    const { data: existingSource, error: sourceLookupError } = await supabase
      .from(UPLOADS_TABLE)
      .select("id")
      .eq("id", sourceImageIdCandidate)
      .single();

    if (sourceLookupError || !existingSource?.id) {
      return {
        sourceUploadId: null,
        sourceUploadError: "Källbilden kunde inte hittas. Välj bilden igen.",
      };
    }

    return {
      sourceUploadId: existingSource.id,
      sourceUploadError: null,
    };
  }

  const extension =
    uploadedFile.name.split(".").pop()?.toLowerCase() ||
    uploadedFile.type.split("/").pop()?.toLowerCase() ||
    "jpg";
  const sourceStoragePath = `${UPLOADS_PREFIX}${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const { error: sourceStorageError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(sourceStoragePath, inputBuffer, {
      upsert: false,
      contentType: uploadedFile.type,
    });

  if (sourceStorageError) {
    return {
      sourceUploadId: null,
      sourceUploadError: "Kunde inte spara originalbilden.",
    };
  }

  const { data: insertedSource, error: sourceInsertError } = await supabase
    .from(UPLOADS_TABLE)
    .insert({
      file_name: uploadedFile.name,
      file_path: sourceStoragePath,
      file_size: inputBuffer.byteLength,
      mime_type: uploadedFile.type || null,
    })
    .select("id")
    .single();

  if (sourceInsertError || !insertedSource?.id) {
    await supabase.storage.from(BUCKET_NAME).remove([sourceStoragePath]);
    return {
      sourceUploadId: null,
      sourceUploadError: "Kunde inte spara metadata för originalbilden.",
    };
  }

  const sourceFileName = imageDownloadFileName(insertedSource.id, extension);
  const { error: sourceRenameError } = await supabase
    .from(UPLOADS_TABLE)
    .update({ file_name: sourceFileName })
    .eq("id", insertedSource.id);

  if (sourceRenameError) {
    await supabase.storage.from(BUCKET_NAME).remove([sourceStoragePath]);
    return {
      sourceUploadId: null,
      sourceUploadError: "Kunde inte spara metadata för originalbilden.",
    };
  }

  return {
    sourceUploadId: insertedSource.id,
    sourceUploadError: null,
  };
}

function toPngDataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/**
 * The before image is a photo on white, which PNG handles badly: at 2560px it came to 6.6 MB
 * as a data URL, past the ~5 MB sessionStorage quota the review cache lives in. JPEG brings
 * the same image to about 0.4 MB.
 */
async function toJpegDataUrl(buffer: Buffer) {
  const jpeg = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

class ConvertFailure extends Error {}

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
  const requestedEngine = resolveImageEngine();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let isClosed = false;
      const send = (event: ConvertStreamEvent) => {
        if (isClosed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        } catch {
          // The client hung up; stop trying to write.
          isClosed = true;
        }
      };

      try {
        send({ type: "status", message: "Förbereder uppladdad bild", engine: requestedEngine });

        const orientedColorBuffer = await prepareSourceImage(inputBuffer);
        const orientedMetadata = await sharp(orientedColorBuffer).metadata();
        const sourceWidth = orientedMetadata.width;
        const sourceHeight = orientedMetadata.height;

        if (!sourceWidth || !sourceHeight) {
          throw new ConvertFailure("Kunde inte läsa bildens storlek.");
        }

        let drawingBuffer = orientedColorBuffer;
        let usedEngine: ConvertEngine = "algorithm";
        // The AI paints the beige itself, so the canvas is padded with the colour it actually
        // produced. Sampling it rather than hardcoding one avoids a visible seam where the
        // drawing meets the padding.
        let drawingBackground: Rgb | undefined;

        if (requestedEngine === "ai") {
          try {
            send({
              type: "status",
              message: "Ritar om planritningen",
              engine: "ai",
            });

            const threshold = resolveStyleThreshold();
            let best: {
              buffer: Buffer;
              background: Rgb;
              width: number;
              height: number;
              deviation: number;
            } | null = null;
            let corrections = feedback;

            for (let attempt = 0; attempt <= MAX_STYLE_RETRIES; attempt += 1) {
              const generationStartedAt = Date.now();
              const generated = await generateFloorplanLineArt({
                sourceImage: orientedColorBuffer,
                sourceWidth,
                sourceHeight,
                feedback: corrections,
                ...(attempt > 0 ? { model: resolveRetryModel() } : {}),
                signal: request.signal,
              });

              const background = await sampleDominantColor(generated.buffer);
              // Measured on the finished page, since that is what anyone compares against the
              // reference plans.
              const preview = await composeBrandedFloorplan(generated.buffer, {
                preserveTones: true,
                backgroundColor: background,
              });
              const measured = await measureStyleDeviation(preview.output);

              // The vision review runs only when it can still change the outcome: a result
              // already over the threshold is being redrawn regardless.
              const review =
                isStyleReviewEnabled() && measured.score <= threshold
                  ? await reviewStyleAgainstReferences(preview.output, request.signal)
                  : null;

              const reviewForcesRedraw = Boolean(
                review && review.score >= resolveReviewTrigger(),
              );
              const deviation = {
                score: reviewForcesRedraw
                  ? Math.max(measured.score, review?.score ?? 0)
                  : measured.score,
                issues: [...measured.issues, ...(review?.issues ?? [])],
              };

              console.info(
                `AI floor plan generated ${JSON.stringify({
                  attempt: attempt + 1,
                  model: generated.model,
                  quality: generated.quality,
                  durationMs: Date.now() - generationStartedAt,
                  generatedSize: generated.size,
                  sourceSize: `${sourceWidth}x${sourceHeight}`,
                  styleReferences: generated.styleReferenceCount,
                  hasFeedback: Boolean(corrections),
                  background,
                  measuredDeviation: Number(measured.score.toFixed(3)),
                  reviewedDeviation: review ? Number(review.score.toFixed(3)) : null,
                  reviewForcedRedraw: reviewForcesRedraw,
                  styleDeviation: Number(deviation.score.toFixed(3)),
                  styleIssues: deviation.issues.length,
                  usage: generated.usage,
                })}`,
              );

              if (!best || deviation.score < best.deviation) {
                best = {
                  buffer: generated.buffer,
                  background,
                  width: generated.width,
                  height: generated.height,
                  deviation: deviation.score,
                };
              }

              const withinStyle = deviation.score <= threshold;
              if (withinStyle || attempt === MAX_STYLE_RETRIES) {
                if (!withinStyle) {
                  console.warn(
                    `Style deviation still above threshold after retry: ${best.deviation.toFixed(3)} > ${threshold}`,
                  );
                }
                break;
              }

              // Name what drifted so the next attempt corrects it instead of re-rolling blind.
              corrections = [feedback, ...deviation.issues].filter(Boolean).join("\n");
              send({
                type: "status",
                message: "Ritar om mot stilmallen",
                engine: "ai",
              });
            }

            if (!best) {
              throw new Error("Bildmodellen returnerade ingen bild.");
            }

            drawingBuffer = best.buffer;
            drawingBackground = best.background;
            usedEngine = "ai";
          } catch (error) {
            if (request.signal.aborted) {
              throw error;
            }

            console.error(
              `AI generation failed, falling back to the algorithm ${JSON.stringify({
                reason: error instanceof Error ? error.message : String(error),
                sourceSize: `${sourceWidth}x${sourceHeight}`,
              })}`,
            );
            send({
              type: "status",
              message: "Slutför konverteringen",
              engine: "algorithm",
            });
          }
        }

        send({ type: "status", message: "Sätter ram och logotyp", engine: usedEngine });

        // Only the AI path produces house-styled line art; the algorithm still needs the
        // threshold and the beige tint to turn a photo into brand output.
        const branded = await composeBrandedFloorplan(drawingBuffer, {
          preserveTones: usedEngine === "ai",
          ...(usedEngine === "ai" && drawingBackground
            ? { backgroundColor: drawingBackground }
            : {}),
        });
        // On the AI path the drawing is not the original, so its crop box must not be applied
        // to the original — the whole upload is fitted into the drawing's slot instead.
        const compareBeforeBuffer = await buildCompareBefore(orientedColorBuffer, branded, {
          cropToDrawing: usedEngine !== "ai",
        });

        send({ type: "status", message: "Sparar planritning", engine: usedEngine });

        const supabase = getAdminSupabase();
        if (!supabase) {
          throw new ConvertFailure("Serverkonfiguration saknas.");
        }
        const { sourceUploadId, sourceUploadError } = await resolveSourceUploadId(
          supabase,
          uploadedFile,
          inputBuffer,
          sourceImageIdValue,
        );

        if (!sourceUploadId || sourceUploadError) {
          throw new ConvertFailure(sourceUploadError ?? "Kunde inte spara källbild.");
        }

        const uniqueGeneratedName = `${Date.now()}-${crypto.randomUUID()}.png`;
        const storagePath = `${GENERATED_PREFIX}${uniqueGeneratedName}`;

        const { error: uploadError } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(storagePath, branded.output, {
            upsert: false,
            contentType: "image/png",
          });

        if (uploadError) {
          console.error("Failed to store generated image", uploadError);
          throw new ConvertFailure("Kunde inte spara den genererade bilden.");
        }

        const { data: insertedImage, error: insertError } = await supabase
          .from(UPLOADS_TABLE)
          .insert({
            file_name: "planritning.png",
            file_path: storagePath,
            file_size: branded.output.byteLength,
            mime_type: "image/png",
            source_upload_id: sourceUploadId,
          })
          .select("id, file_path")
          .single();

        if (insertError || !insertedImage?.id) {
          await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
          console.error("Failed to store generated image metadata", insertError);
          throw new ConvertFailure("Kunde inte spara bildens metadata.");
        }

        const generatedFileName = imageDownloadFileName(insertedImage.id, "png");
        const { error: generatedRenameError } = await supabase
          .from(UPLOADS_TABLE)
          .update({ file_name: generatedFileName })
          .eq("id", insertedImage.id);

        if (generatedRenameError) {
          await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
          console.error("Failed to rename generated image metadata", generatedRenameError);
          throw new ConvertFailure("Kunde inte spara bildens metadata.");
        }

        // Version for the stable image URL, and the thumbnail made while the bytes are in hand.
        let version: string | null = null;
        try {
          const { data: listed } = await supabase.storage
            .from(BUCKET_NAME)
            .list(GENERATED_PREFIX.replace(/\/$/, ""), { search: uniqueGeneratedName, limit: 1 });
          version = normaliseEtag((listed?.[0]?.metadata as { eTag?: unknown } | null)?.eTag);
          await supabase.storage
            .from(BUCKET_NAME)
            .upload(
              thumbnailPath(storagePath, version ?? String(branded.output.byteLength)),
              await createThumbnail(branded.output),
              { contentType: "image/webp", upsert: true },
            );
        } catch (thumbnailError) {
          console.error("Thumbnail generation failed after conversion", thumbnailError);
        }
        const savedImageUrl = imageUrl(insertedImage.id, "full", version);

        send({
          type: "done",
          engine: usedEngine,
          savedImageId: insertedImage.id,
          savedImagePath: storagePath,
          savedImageUrl,
          sourceImageId: sourceUploadId,
          compareBefore: await toJpegDataUrl(compareBeforeBuffer),
          // Only pay the base64 cost when the client has no signed URL to load instead.
          result: savedImageUrl ? "" : toPngDataUrl(branded.output),
          layout: {
            canvasWidth: branded.canvasWidth,
            canvasHeight: branded.canvasHeight,
            imageX: branded.imageX,
            imageY: branded.imageY,
            imageWidth: branded.imageWidth,
            imageHeight: branded.imageHeight,
            cropLeft: branded.crop.left,
            cropTop: branded.crop.top,
            cropWidth: branded.crop.width,
            cropHeight: branded.crop.height,
            preparedWidth: branded.preparedWidth,
            preparedHeight: branded.preparedHeight,
            outerFrameInset: branded.metrics.frameInset,
            outerFrameStroke: branded.metrics.frameStroke,
          },
        });
      } catch (error) {
        console.error("Image conversion failed", error);
        send({
          type: "error",
          message:
            error instanceof ConvertFailure ? error.message : "Kunde inte bearbeta bilden.",
        });
      } finally {
        isClosed = true;
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": CONVERT_STREAM_CONTENT_TYPE,
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

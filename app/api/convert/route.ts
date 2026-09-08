import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  CONVERT_STREAM_CONTENT_TYPE,
  encodeSseEvent,
  type ConvertEngine,
  type ConvertStreamEvent,
} from "@/lib/floorplan/convert-stream";
import { imageDownloadFileName } from "@/lib/image-naming";
import { generateFloorplanLineArt, resolveImageEngine } from "@/lib/image/ai-floorplan";
import {
  buildCompareBefore,
  composeBrandedFloorplan,
  prepareSourceImage,
  sampleDominantColor,
  type Rgb,
} from "@/lib/image/brand-floorplan";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const GENERATION_EVENTS_TABLE = "generation_events";
const GENERATED_PREFIX = "generated/";
const UPLOADS_PREFIX = "uploads/";

export const runtime = "nodejs";

/** Image generation with reference images can take up to two minutes. */
export const maxDuration = 300;

function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment variables are missing.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function insertGenerationEvent(supabase: ReturnType<typeof createSupabaseServerClient>) {
  const { error } = await supabase.from(GENERATION_EVENTS_TABLE).insert({});
  return error ?? null;
}

async function resolveSourceUploadId(
  supabase: ReturnType<typeof createSupabaseServerClient>,
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

class ConvertFailure extends Error {}

export async function POST(request: Request) {
  const formData = await request.formData();
  const uploadedFile = formData.get("file");
  const sourceImageIdValue = formData.get("sourceImageId");

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
        // The image the "before" half of the comparison is cut from. It has to match the
        // drawing pixel for pixel, because both use the same crop box.
        let compareSourceBuffer = orientedColorBuffer;
        let usedEngine: ConvertEngine = "algorithm";
        // The AI paints the beige itself, so the canvas is padded with the colour it actually
        // produced. Sampling it rather than hardcoding one avoids a visible seam where the
        // drawing meets the padding.
        let drawingBackground: Rgb | undefined;

        if (requestedEngine === "ai") {
          try {
            send({
              type: "status",
              message: "AI ritar om planritningen efter stilreferenserna",
              engine: "ai",
            });

            const generated = await generateFloorplanLineArt({
              sourceImage: orientedColorBuffer,
              sourceWidth,
              sourceHeight,
              signal: request.signal,
            });

            drawingBuffer = generated.buffer;
            drawingBackground = await sampleDominantColor(generated.buffer);
            // The drawing now comes back at the generated resolution, which is usually larger
            // than the upload. Scale the original up to match so the crop box lands correctly.
            compareSourceBuffer = await sharp(orientedColorBuffer)
              .resize({ width: generated.width, height: generated.height, fit: "fill" })
              .png()
              .toBuffer();
            usedEngine = "ai";

            // Serialised into the message because Next's dev logger drops extra console args.
            console.info(
              `AI floor plan generated ${JSON.stringify({
                model: generated.model,
                generatedSize: generated.size,
                deliveredSize: `${generated.width}x${generated.height}`,
                sourceSize: `${sourceWidth}x${sourceHeight}`,
                styleReferences: generated.styleReferenceCount,
                background: drawingBackground,
                usage: generated.usage,
              })}`,
            );
          } catch (error) {
            if (request.signal.aborted) {
              throw error;
            }

            console.error("AI generation failed, falling back to the algorithm", error);
            send({
              type: "status",
              message: "AI-steget misslyckades – slutför med standardalgoritmen",
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
        const compareBeforeBuffer = await buildCompareBefore(compareSourceBuffer, branded);

        send({ type: "status", message: "Sparar planritning", engine: usedEngine });

        const supabase = createSupabaseServerClient();
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

        const generationEventError = await insertGenerationEvent(supabase);
        if (generationEventError) {
          // Keep conversion successful even if event logging fails.
          console.error("Failed to store generation event", generationEventError);
        }

        const { data: signedImageData } = await supabase.storage
          .from(BUCKET_NAME)
          .createSignedUrl(storagePath, 3600);
        const savedImageUrl = signedImageData?.signedUrl ?? null;

        send({
          type: "done",
          engine: usedEngine,
          savedImageId: insertedImage.id,
          savedImagePath: storagePath,
          savedImageUrl,
          sourceImageId: sourceUploadId,
          compareBefore: toPngDataUrl(compareBeforeBuffer),
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

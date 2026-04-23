import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import path from "node:path";

const TARGET_MAX_WIDTH = 1200;
const LINE_THRESHOLD = 190;
const ASPECT_RATIO_WIDTH = 7;
const ASPECT_RATIO_HEIGHT = 5;
const CONTENT_PADDING_PX = 80;
const LOGO_GAP_PX = 44;
const OUTER_FRAME_STROKE_PX = 3;
const OUTER_FRAME_INSET_PX = 30;
const LOGO_MAX_WIDTH_PX = 360;
const LOGO_WIDTH_RATIO = 0.3;
const BEIGE_BACKGROUND = { r: 225, g: 212, b: 200, alpha: 1 };
const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const GENERATION_EVENTS_TABLE = "generation_events";
const GENERATED_PREFIX = "generated/";
const UPLOADS_PREFIX = "uploads/";

export const runtime = "nodejs";

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

function buildGeneratedFileName(originalName: string) {
  const parsed = path.parse(originalName);
  const stem = parsed.name.trim() || "planritning";
  return `${stem}-bearbetad.png`;
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

  return {
    sourceUploadId: insertedSource.id,
    sourceUploadError: null,
  };
}

export async function POST(request: Request) {
  try {
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

    const processedImageBuffer = await sharp(inputBuffer)
      .rotate()
      .resize({
        width: TARGET_MAX_WIDTH,
        withoutEnlargement: true,
      })
      .grayscale()
      .threshold(LINE_THRESHOLD)
      .png()
      .toBuffer();

    const processedMetadata = await sharp(processedImageBuffer).metadata();
    const imageWidth = processedMetadata.width;
    const imageHeight = processedMetadata.height;

    if (!imageWidth || !imageHeight) {
      return NextResponse.json({ message: "Kunde inte läsa bildens storlek." }, { status: 400 });
    }

    const beigeOverlay = Buffer.from(
      `<svg width="${imageWidth}" height="${imageHeight}">
        <rect width="100%" height="100%" fill="rgb(${BEIGE_BACKGROUND.r},${BEIGE_BACKGROUND.g},${BEIGE_BACKGROUND.b})" />
      </svg>`,
    );

    const beigeTintedImageBuffer = await sharp(processedImageBuffer)
      .composite([
        {
          input: beigeOverlay,
          blend: "multiply",
        },
      ])
      .png()
      .toBuffer();

    const logoFilePath = path.join(process.cwd(), "public", "sm-logo.svg");
    const desiredLogoWidth = Math.min(LOGO_MAX_WIDTH_PX, Math.round(imageWidth * LOGO_WIDTH_RATIO));
    const logoBuffer = await sharp(logoFilePath)
      .resize({
        width: desiredLogoWidth,
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    const logoMetadata = await sharp(logoBuffer).metadata();
    const logoWidth = logoMetadata.width;
    const logoHeight = logoMetadata.height;

    if (!logoWidth || !logoHeight) {
      return NextResponse.json({ message: "Kunde inte läsa loggans storlek." }, { status: 500 });
    }

    const contentWidth = Math.max(imageWidth, logoWidth);
    const contentHeight = imageHeight + LOGO_GAP_PX + logoHeight;
    const minCanvasWidth = contentWidth + CONTENT_PADDING_PX * 2;
    const minCanvasHeight = contentHeight + CONTENT_PADDING_PX * 2;
    const canvasScale = Math.ceil(
      Math.max(minCanvasWidth / ASPECT_RATIO_WIDTH, minCanvasHeight / ASPECT_RATIO_HEIGHT),
    );
    const canvasWidth = canvasScale * ASPECT_RATIO_WIDTH;
    const canvasHeight = canvasScale * ASPECT_RATIO_HEIGHT;

    const imageX = Math.floor((canvasWidth - imageWidth) / 2);
    const contentTop = Math.floor((canvasHeight - contentHeight) / 2);
    const imageY = contentTop;
    const logoX = Math.floor((canvasWidth - logoWidth) / 2);
    const logoY = imageY + imageHeight + LOGO_GAP_PX;
    const frameOverlay = Buffer.from(
      `<svg width="${canvasWidth}" height="${canvasHeight}">
        <rect
          x="${OUTER_FRAME_INSET_PX + OUTER_FRAME_STROKE_PX / 2}"
          y="${OUTER_FRAME_INSET_PX + OUTER_FRAME_STROKE_PX / 2}"
          width="${canvasWidth - OUTER_FRAME_INSET_PX * 2 - OUTER_FRAME_STROKE_PX}"
          height="${canvasHeight - OUTER_FRAME_INSET_PX * 2 - OUTER_FRAME_STROKE_PX}"
          fill="none"
          stroke="#000000"
          stroke-width="${OUTER_FRAME_STROKE_PX}"
        />
      </svg>`,
    );

    const outputBuffer = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: BEIGE_BACKGROUND,
      },
    })
      .composite([
        {
          input: beigeTintedImageBuffer,
          left: imageX,
          top: imageY,
        },
        {
          input: logoBuffer,
          left: logoX,
          top: logoY,
        },
        {
          input: frameOverlay,
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();

    const supabase = createSupabaseServerClient();
    const { sourceUploadId, sourceUploadError } = await resolveSourceUploadId(
      supabase,
      uploadedFile,
      inputBuffer,
      sourceImageIdValue,
    );
    if (!sourceUploadId || sourceUploadError) {
      return NextResponse.json({ message: sourceUploadError ?? "Kunde inte spara källbild." }, { status: 400 });
    }

    const uniqueGeneratedName = `${Date.now()}-${crypto.randomUUID()}.png`;
    const storagePath = `${GENERATED_PREFIX}${uniqueGeneratedName}`;
    const generatedFileName = buildGeneratedFileName(uploadedFile.name);

    const { error: uploadError } = await supabase.storage.from(BUCKET_NAME).upload(storagePath, outputBuffer, {
      upsert: false,
      contentType: "image/png",
    });

    if (uploadError) {
      console.error("Failed to store generated image", uploadError);
      return NextResponse.json({ message: "Kunde inte spara den genererade bilden." }, { status: 500 });
    }

    const { data: insertedImage, error: insertError } = await supabase
      .from(UPLOADS_TABLE)
      .insert({
        file_name: generatedFileName,
        file_path: storagePath,
        file_size: outputBuffer.byteLength,
        mime_type: "image/png",
        source_upload_id: sourceUploadId,
      })
      .select("id, file_path")
      .single();

    if (insertError) {
      await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
      console.error("Failed to store generated image metadata", insertError);
      return NextResponse.json({ message: "Kunde inte spara bildens metadata." }, { status: 500 });
    }

    const generationEventError = await insertGenerationEvent(supabase);
    if (generationEventError) {
      // Keep conversion successful even if event logging fails.
      console.error("Failed to store generation event", generationEventError);
    }

    const { data: signedImageData } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(storagePath, 3600);
    const savedImageUrl = signedImageData?.signedUrl ?? null;

    return new Response(new Uint8Array(outputBuffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        ...(savedImageUrl ? { "X-Saved-Image-Url": savedImageUrl } : {}),
        ...(insertedImage?.id ? { "X-Saved-Image-Id": String(insertedImage.id) } : {}),
        "X-Source-Image-Id": String(sourceUploadId),
        "X-Saved-Image-Path": storagePath,
      },
    });
  } catch (error) {
    console.error("Image conversion failed", error);
    return NextResponse.json({ message: "Kunde inte bearbeta bilden." }, { status: 500 });
  }
}

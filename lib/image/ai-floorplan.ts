import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import OpenAI, { toFile, type Uploadable } from "openai";
import sharp from "sharp";

const STYLE_REFERENCE_DIR = path.join(process.cwd(), "assets", "style-references");
const SUPPORTED_REFERENCE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * References are downscaled before they are sent, but keep their colours: the model is asked
 * to reproduce the beige house style, so it needs to see it. Downscaling keeps the input
 * token cost down — every reference is billed at high fidelity.
 */
const REFERENCE_MAX_EDGE = 1024;

/** The edits endpoint accepts 16 images in total; one slot is the customer's floor plan. */
const MAX_STYLE_REFERENCES = 15;

const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_QUALITY = "high";

/**
 * gpt-image-2 requires both edges divisible by 16 and an aspect ratio within 1:3–3:1.
 * The long edge is the second lever on text quality: at 2048 a room label gets a third more
 * pixels per glyph than at 1536. Anything above 2560 is experimental at the API and costs
 * disproportionately.
 */
const GENERATED_LONG_EDGE = 2560;
const SIZE_MULTIPLE = 16;
const MIN_EDGE_PX = 512;
const MAX_ASPECT_RATIO = 3;

/** Hard ceiling from the API. Squarer plans hit it first, so the size is clamped by area. */
const MAX_GENERATED_PIXELS = 8_294_400;

/**
 * The house style lives in STILREGLER.md so it can be edited without touching code. Only the
 * block between these markers is sent to the model; the rest of the file is documentation.
 */
const STYLE_RULES_FILE = path.join(STYLE_REFERENCE_DIR, "STILREGLER.md");
const PROMPT_START_MARKER = "<!-- PROMPT:START -->";
const PROMPT_END_MARKER = "<!-- PROMPT:END -->";

/** Used only when STILREGLER.md is missing or has lost its markers. */
const FALLBACK_PROMPT = `Rita om planritningen i den första bilden som en ren, teknisk linjeritning.

- Behåll rummens antal, form, placering och proportioner exakt som i den första bilden.
- Rita väggar som massivt ifyllda, helsvarta linjer. Yttervägg tjockare än innervägg.
- Rita fönster som helt vita rektanglar infällda i den svarta väggen.
- Rita dörrar som ett glapp i väggen plus en tunn kvartscirkel som visar svepet.
- Måla hela bakgrunden i exakt #E1D5C9, linjer och text i #000000, fönster i #FFFFFF. Inga andra färger, inga gråtoner och ingen skuggning.
- Rita ingen ram, ingen logotyp, ingen rubrik, ingen kompassros och ingen adress.`;

const STYLE_REFERENCE_PROMPT = `

Bilderna efter den första är stilreferenser. Härma hur de ritar väggar, dörrar, fönster, fast inredning, förkortningsrutor och rumsetiketter — linjetjocklek, symbolspråk, typsnitt och detaljnivå.

Två saker får du aldrig ta med från referenserna: deras planlösning, och sidans övriga innehåll. Referenserna innehåller rubrik, kompassros, adress, brödtext och logotyp runt själva ritningen. Rita inte av något av det — det läggs på i ett separat steg efteråt. Leverera bara själva planritningen.`;

export type StyleReference = {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
};

export type AiFloorplanUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type GenerateFloorplanLineArtOptions = {
  /** The oriented source photo. The result is returned at exactly these dimensions. */
  sourceImage: Buffer;
  sourceWidth: number;
  sourceHeight: number;
  /** Why a previous attempt on this image was rejected, if there was one. */
  feedback?: string;
  /** Overrides the configured model. Used to retry a rejected result a different way. */
  model?: string;
  signal?: AbortSignal;
};

export type GenerateFloorplanLineArtResult = {
  buffer: Buffer;
  /** Native size of the returned drawing. It is the generated size, not the source size. */
  width: number;
  height: number;
  model: string;
  quality: string;
  size: string;
  styleReferenceCount: number;
  usage: AiFloorplanUsage | null;
};

let cachedStyleReferences: StyleReference[] | null = null;
let cachedStyleRules: string | null = null;

/**
 * Reads the prompted section of STILREGLER.md once per server instance. Falls back to a
 * built-in prompt so a missing or malformed file degrades the output instead of breaking it.
 */
export async function loadStyleRules(): Promise<string> {
  if (cachedStyleRules) {
    return cachedStyleRules;
  }

  try {
    const markdown = await readFile(STYLE_RULES_FILE, "utf8");
    const start = markdown.indexOf(PROMPT_START_MARKER);
    const end = markdown.indexOf(PROMPT_END_MARKER);

    if (start !== -1 && end > start) {
      const rules = markdown.slice(start + PROMPT_START_MARKER.length, end).trim();
      if (rules.length > 0) {
        cachedStyleRules = rules;
        return cachedStyleRules;
      }
    }

    console.warn("STILREGLER.md saknar PROMPT-markörer, använder inbyggd prompt.");
  } catch {
    console.warn("STILREGLER.md kunde inte läsas, använder inbyggd prompt.");
  }

  cachedStyleRules = FALLBACK_PROMPT;
  return cachedStyleRules;
}

export function isAiEngineConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Which engine the convert route should use. Defaults to the AI engine whenever an API key
 * is present, so the algorithm stays available as an explicit escape hatch.
 */
export function resolveImageEngine(): "ai" | "algorithm" {
  const configured = process.env.IMAGE_ENGINE?.trim().toLowerCase();
  if (configured === "algorithm" || configured === "algoritm") {
    return "algorithm";
  }
  if (configured === "ai") {
    return "ai";
  }

  return isAiEngineConfigured() ? "ai" : "algorithm";
}

/** Reads the hand-picked style references from disk once per server instance. */
export async function loadStyleReferences(): Promise<StyleReference[]> {
  if (cachedStyleReferences) {
    return cachedStyleReferences;
  }

  let entries: string[];
  try {
    entries = await readdir(STYLE_REFERENCE_DIR);
  } catch {
    cachedStyleReferences = [];
    return cachedStyleReferences;
  }

  const fileNames = entries
    .filter((entry) => SUPPORTED_REFERENCE_EXTENSIONS.has(path.extname(entry).toLowerCase()))
    .sort()
    .slice(0, MAX_STYLE_REFERENCES);

  const references = await Promise.all(
    fileNames.map(async (fileName) => ({
      fileName: `${path.basename(fileName, path.extname(fileName))}.png`,
      buffer: await sharp(await readFile(path.join(STYLE_REFERENCE_DIR, fileName)))
        .rotate()
        .resize({
          width: REFERENCE_MAX_EDGE,
          height: REFERENCE_MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer(),
      mimeType: "image/png",
    })),
  );

  cachedStyleReferences = references;
  return references;
}

/**
 * The long edge rounds down and the short edge rounds up, so rounding can only ever move the
 * result towards square. Rounding the short edge to nearest can push an elongated plan past
 * the 3:1 cap the API enforces, which fails the whole request.
 */
function floorToSizeMultiple(value: number) {
  return Math.max(MIN_EDGE_PX, Math.floor(value / SIZE_MULTIPLE) * SIZE_MULTIPLE);
}

function ceilToSizeMultiple(value: number) {
  return Math.max(MIN_EDGE_PX, Math.ceil(value / SIZE_MULTIPLE) * SIZE_MULTIPLE);
}

/** Picks a generation size that keeps the source aspect ratio inside the model's limits. */
export function resolveGeneratedSize(width: number, height: number) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const ratio = Math.min(
    MAX_ASPECT_RATIO,
    Math.max(1 / MAX_ASPECT_RATIO, safeWidth / safeHeight),
  );

  let rawWidth = ratio >= 1 ? GENERATED_LONG_EDGE : GENERATED_LONG_EDGE * ratio;
  let rawHeight = ratio >= 1 ? GENERATED_LONG_EDGE / ratio : GENERATED_LONG_EDGE;

  const pixels = rawWidth * rawHeight;
  if (pixels > MAX_GENERATED_PIXELS) {
    const shrink = Math.sqrt(MAX_GENERATED_PIXELS / pixels);
    rawWidth *= shrink;
    rawHeight *= shrink;
  }

  return ratio >= 1
    ? { width: floorToSizeMultiple(rawWidth), height: ceilToSizeMultiple(rawHeight) }
    : { width: ceilToSizeMultiple(rawWidth), height: floorToSizeMultiple(rawHeight) };
}

function createClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY saknas.");
  }

  return new OpenAI({ apiKey });
}

function supportsInputFidelity(model: string) {
  // gpt-image-2 always processes inputs at high fidelity and rejects the parameter.
  return model === "gpt-image-1" || model.startsWith("gpt-image-1.");
}

async function toUploadable(buffer: Buffer, fileName: string, mimeType: string): Promise<Uploadable> {
  return toFile(buffer, fileName, { type: mimeType });
}

/**
 * Redraws an uploaded floor plan photo as clean line art, using the hand-picked style
 * references as inspiration. The result is returned at the source dimensions so the rest of
 * the pipeline can treat it exactly like the original image.
 */
export async function generateFloorplanLineArt({
  sourceImage,
  sourceWidth,
  sourceHeight,
  feedback,
  model: modelOverride,
  signal,
}: GenerateFloorplanLineArtOptions): Promise<GenerateFloorplanLineArtResult> {
  const client = createClient();
  const model = modelOverride?.trim() || process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
  const quality = (process.env.OPENAI_IMAGE_QUALITY?.trim() || DEFAULT_QUALITY) as
    | "low"
    | "medium"
    | "high"
    | "auto";

  const [styleReferences, styleRules] = await Promise.all([
    loadStyleReferences(),
    loadStyleRules(),
  ]);
  const generatedSize = resolveGeneratedSize(sourceWidth, sourceHeight);
  const size = `${generatedSize.width}x${generatedSize.height}`;

  const image: Uploadable[] = [
    await toUploadable(sourceImage, "planritning.png", "image/png"),
    ...(await Promise.all(
      styleReferences.map((reference) =>
        toUploadable(reference.buffer, reference.fileName, reference.mimeType),
      ),
    )),
  ];

  const basePrompt =
    styleReferences.length > 0 ? `${styleRules}${STYLE_REFERENCE_PROMPT}` : styleRules;

  // Placed last so it reads as a correction to everything above it.
  const prompt = feedback
    ? `${basePrompt}\n\nEtt tidigare försök på den här planritningen nekades med följande motivering. Rätta det den här gången, utan att bryta mot reglerna ovan:\n${feedback}`
    : basePrompt;

  // Returned at the size the model drew it. Scaling it down to the upload's dimensions would
  // throw away exactly the resolution that was paid for — a 640px photo would cap a 2048px
  // drawing back to 640px, taking the text legibility with it.
  const toPng = (base64: string) => sharp(Buffer.from(base64, "base64")).png().toBuffer();

  const stream = await client.images.edit(
    {
      model,
      image,
      prompt,
      size,
      quality,
      output_format: "png",
      background: "opaque",
      // Streaming keeps the connection alive through a long generation. No partial images are
      // requested: nothing renders them, and compositing previews nobody sees is wasted work.
      stream: true,
      partial_images: 0,
      ...(supportsInputFidelity(model) ? { input_fidelity: "high" as const } : {}),
    },
    { signal },
  );

  let finalBuffer: Buffer | null = null;
  let usage: AiFloorplanUsage | null = null;

  for await (const event of stream) {
    if (event.type === "image_edit.completed") {
      finalBuffer = await toPng(event.b64_json);
      usage = {
        inputTokens: event.usage.input_tokens,
        outputTokens: event.usage.output_tokens,
        totalTokens: event.usage.total_tokens,
      };
    }
  }

  if (!finalBuffer) {
    throw new Error("Bildmodellen returnerade ingen bild.");
  }

  return {
    buffer: finalBuffer,
    width: generatedSize.width,
    height: generatedSize.height,
    model,
    quality,
    size,
    styleReferenceCount: styleReferences.length,
    usage,
  };
}

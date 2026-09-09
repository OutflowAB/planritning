import OpenAI from "openai";
import sharp from "sharp";

import { loadStyleReferences } from "@/lib/image/ai-floorplan";

/**
 * Has a vision model compare a finished floor plan against the approved reference plans.
 *
 * This exists alongside the measured check in style-conformance.ts because the two catch
 * different failures. Measurement is exact about the palette and blind to meaning: it cannot
 * tell that the model invented a room, garbled a label or drew a door as a window. This can,
 * and is correspondingly slower, costlier and less repeatable. Either one may trigger a
 * redraw, so a result has to satisfy both.
 */

const DEFAULT_REVIEW_MODEL = "gpt-5-mini";

/** Small on purpose. The judgement is about style and structure, not fine detail. */
const REVIEW_IMAGE_EDGE = 512;

const REVIEW_INSTRUCTIONS = `Du granskar en genererad planritning mot våra godkända referensplaner.

Den första bilden är den genererade planritningen. De följande är våra godkända referenser.

Bedöm hur väl den genererade bilden hör hemma bland referenserna, med avseende på:
- färgerna: beige bakgrund, svarta linjer och text, vita fönster
- väggarna: massivt svarta, ytterväggar tjockare än innerväggar
- fönster som vita segment infällda i väggen, dörrar som glapp med kvartscirkelsvep
- rumsnamn i versaler som går att läsa, utan påhittade eller obegripliga ord
- fast inredning i tunn kontur, förkortningsrutor med versaler

Bedöm INTE planlösningen i sig. Referenserna visar andra bostäder, så rummens antal och form
ska skilja sig. Referenserna innehåller dessutom rubrik, kompassros, adress och logotyp som
den genererade bilden medvetet saknar — räkna inte det som fel.

Svara med hur många procent bilden avviker från referensernas stil, och en kort punktlista på
svenska med det som behöver rättas. Är bilden stilmässigt likvärdig ska avvikelsen vara låg.`;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    deviationPercent: {
      type: "integer",
      description: "0 om bilden är stilmässigt likvärdig med referenserna, 100 om den saknar all likhet.",
    },
    issues: {
      type: "array",
      description: "Kort punktlista på svenska med det som behöver rättas. Tom om inget behöver rättas.",
      items: { type: "string" },
    },
  },
  required: ["deviationPercent", "issues"],
  additionalProperties: false,
} as const;

export type StyleReview = {
  /** 0–1, to match the measured deviation's scale. */
  score: number;
  issues: string[];
};

export function isStyleReviewEnabled() {
  return process.env.STYLE_REVIEW_ENABLED?.trim().toLowerCase() === "true";
}

async function toDataUrl(buffer: Buffer) {
  const resized = await sharp(buffer)
    .resize({ width: REVIEW_IMAGE_EDGE, height: REVIEW_IMAGE_EDGE, fit: "inside" })
    .png()
    .toBuffer();

  return `data:image/png;base64,${resized.toString("base64")}`;
}

/**
 * Returns null when the review could not be carried out. A failed review must never block a
 * generation that is otherwise fine — the measured check still applies.
 */
export async function reviewStyleAgainstReferences(
  imageBuffer: Buffer,
  signal?: AbortSignal,
): Promise<StyleReview | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const references = await loadStyleReferences();
    const client = new OpenAI({ apiKey });

    const content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" }> = [
      { type: "input_text", text: REVIEW_INSTRUCTIONS },
      { type: "input_image", image_url: await toDataUrl(imageBuffer), detail: "auto" },
    ];

    for (const reference of references) {
      content.push({
        type: "input_image",
        image_url: await toDataUrl(reference.buffer),
        detail: "auto",
      });
    }

    const response = await client.responses.create(
      {
        model: process.env.STYLE_REVIEW_MODEL?.trim() || DEFAULT_REVIEW_MODEL,
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: "style_review",
            schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        },
      },
      { signal },
    );

    const parsed = JSON.parse(response.output_text) as {
      deviationPercent?: number;
      issues?: string[];
    };

    const percent = Number(parsed.deviationPercent);
    if (!Number.isFinite(percent)) {
      return null;
    }

    return {
      score: Math.min(1, Math.max(0, percent / 100)),
      issues: Array.isArray(parsed.issues) ? parsed.issues.filter((issue) => Boolean(issue)) : [],
    };
  } catch (error) {
    console.error("Style review failed, keeping the measured verdict", error);
    return null;
  }
}

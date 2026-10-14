import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateFloorplanLineArt,
  loadScanRules,
  loadStyleRules,
  resolveGeneratedSize,
} from "@/lib/image/ai-floorplan";

/** Every prompt the code would have sent to the image API. */
const sentPrompts = vi.hoisted(() => [] as string[]);

vi.mock("openai", async () => {
  const { default: sharpModule } = await import("sharp");
  const png = await sharpModule({
    create: { width: 8, height: 8, channels: 3, background: { r: 225, g: 213, b: 201 } },
  })
    .png()
    .toBuffer();

  return {
    default: class {
      images = {
        edit: async ({ prompt }: { prompt: string }) => {
          sentPrompts.push(prompt);
          return (async function* () {
            yield {
              type: "image_edit.completed",
              b64_json: png.toString("base64"),
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            };
          })();
        },
      };
    },
    toFile: async (_buffer: unknown, name: string) => ({ name }),
  };
});

/** Limits documented by the image API for gpt-image-2. */
const MAX_PIXELS = 8_294_400;
const MIN_PIXELS = 655_360;
const MAX_EDGE = 3840;

describe("resolveGeneratedSize", () => {
  it.each([
    [2560, 1920],
    [1930, 1370],
    [2560, 2560],
    [638, 480],
    [2560, 853],
    [4000, 800],
    [800, 4000],
    [1, 1],
    [3000, 999],
    [1200, 1],
  ])("%ix%i stays inside the API's limits", (width, height) => {
    const size = resolveGeneratedSize(width, height);
    const pixels = size.width * size.height;
    const ratio = size.width / size.height;

    expect(size.width % 16).toBe(0);
    expect(size.height % 16).toBe(0);
    expect(ratio).toBeLessThanOrEqual(3);
    expect(ratio).toBeGreaterThanOrEqual(1 / 3);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_EDGE);
    expect(pixels).toBeLessThanOrEqual(MAX_PIXELS);
    expect(pixels).toBeGreaterThanOrEqual(MIN_PIXELS);
  });

  it("keeps the source orientation", () => {
    expect(resolveGeneratedSize(2000, 1000).width).toBeGreaterThan(resolveGeneratedSize(2000, 1000).height);
    expect(resolveGeneratedSize(1000, 2000).height).toBeGreaterThan(resolveGeneratedSize(1000, 2000).width);
  });

  // Regression: rounding the short edge to nearest pushed 2560x853 to 2560x848, ratio 3.019,
  // which the API rejects with 400.
  it("never rounds an elongated plan past 3:1", () => {
    const size = resolveGeneratedSize(2560, 853);
    expect(size.width / size.height).toBeLessThanOrEqual(3);
  });
});

/**
 * The paragraph that follows the house rules whenever style references are attached. Copied
 * here on purpose: if the code's copy changes, the photo prompt has changed.
 */
const STYLE_REFERENCE_PARAGRAPH = `

Bilderna efter den första är stilreferenser. Härma hur de ritar väggar, dörrar, fönster, fast inredning, förkortningsrutor och rumsetiketter — linjetjocklek, symbolspråk, typsnitt och detaljnivå.

Två saker får du aldrig ta med från referenserna: deras planlösning, och sidans övriga innehåll. Referenserna innehåller rubrik, kompassros, adress, brödtext och logotyp runt själva ritningen. Rita inte av något av det — det läggs på i ett separat steg efteråt. Leverera bara själva planritningen.`;

const FEEDBACK_INTRO =
  "\n\nEtt tidigare försök på den här planritningen nekades med följande motivering. Rätta det den här gången, utan att bryta mot reglerna ovan:\n";

describe("generateFloorplanLineArt prompt", () => {
  let sourceImage: Buffer;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "test-key-not-real";
    sourceImage = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
  });

  beforeEach(() => {
    sentPrompts.length = 0;
  });

  const generate = (options: { feedback?: string; sourceKind?: "photo" | "scan" } = {}) =>
    generateFloorplanLineArt({ sourceImage, sourceWidth: 800, sourceHeight: 600, ...options });

  // Guards the photo upload against the scan feature: its prompt is exactly the house rules
  // plus the reference paragraph, as it was before scans existed.
  it("sends the photo prompt unchanged", async () => {
    const rules = await loadStyleRules();
    await generate();
    await generate({ sourceKind: "photo" });
    await generate({ feedback: "Tjockare väggar." });

    expect(sentPrompts[0]).toBe(`${rules}${STYLE_REFERENCE_PARAGRAPH}`);
    expect(sentPrompts[1]).toBe(sentPrompts[0]);
    expect(sentPrompts[2]).toBe(`${rules}${STYLE_REFERENCE_PARAGRAPH}${FEEDBACK_INTRO}Tjockare väggar.`);
    expect(sentPrompts.join("")).not.toContain("3D-skanning");
  });

  it("adds the scan block after the house rules and before any feedback", async () => {
    const rules = await loadStyleRules();
    const scanRules = await loadScanRules();
    await generate({ sourceKind: "scan" });
    await generate({ sourceKind: "scan", feedback: "Rita fönstren större." });

    expect(sentPrompts[0]).toBe(`${rules}${STYLE_REFERENCE_PARAGRAPH}\n\n${scanRules}`);
    expect(sentPrompts[1]).toBe(`${sentPrompts[0]}${FEEDBACK_INTRO}Rita fönstren större.`);
  });

  it("reads the scan block from STILREGLER.md, separate from the photo rules", async () => {
    const rules = await loadStyleRules();
    const scanRules = await loadScanRules();

    expect(scanRules).toMatch(/^Om den första bilden: den är inte ett foto/);
    expect(scanRules).toMatch(/Skriv därför inga rumsnamn/);
    expect(scanRules).not.toContain("<!--");
    expect(rules).not.toContain("3D-skanning");
    expect(rules).not.toContain("SCAN-PROMPT");
  });
});

import type { FurnitureDefinition, FloorplanSymbolDefinition } from "@/lib/floorplan/types";

/*
 * Every icon is drawn at its real size in centimetres (`size`), in the house style of the
 * reference plans: thin black outlines, never filled, round caps and joins. Shapes stay 1 cm
 * inside their box so the line is never clipped. Appliances and storage are not pictures but
 * boxes with the abbreviation the reference plans use (`text`).
 */

function rect(x: number, y: number, width: number, height: number) {
  return `M${x} ${y} h${width} v${height} h${-width} Z`;
}

function roundedRect(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  return (
    `M${x + r} ${y} h${width - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${height - 2 * r} ` +
    `a${r} ${r} 0 0 1 ${-r} ${r} h${-(width - 2 * r)} a${r} ${r} 0 0 1 ${-r} ${-r} ` +
    `v${-(height - 2 * r)} a${r} ${r} 0 0 1 ${r} ${-r} Z`
  );
}

function circle(cx: number, cy: number, radius: number) {
  return `M${cx - radius} ${cy} a${radius} ${radius} 0 1 0 ${radius * 2} 0 a${radius} ${radius} 0 1 0 ${-radius * 2} 0`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number) {
  return `M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
}

/** A tap seen from above: a spout from where it is mounted, ending over the basin. */
function tap(fromX: number, fromY: number, toX: number, toY: number) {
  return [`M${fromX} ${fromY} L${toX} ${toY}`, circle(toX, toY, 1.6)];
}

/** An appliance or cupboard: a box with its abbreviation, as on the reference plans. */
function labelledBox(width: number, height: number) {
  return [rect(1, 1, width - 2, height - 2)];
}

export const FLOORPLAN_SYMBOLS: FloorplanSymbolDefinition[] = [
  {
    id: "wc",
    label: "WC",
    category: "badrum",
    size: [40, 70],
    // Cistern against the wall, bowl meeting it, as on the reference plans.
    paths: [roundedRect(3, 1, 34, 18, 3), ellipse(20, 43, 15, 24)],
  },
  {
    id: "handfat",
    label: "Handfat",
    category: "badrum",
    size: [55, 45],
    paths: [rect(1, 1, 53, 43), roundedRect(8, 12, 39, 26, 6), circle(27.5, 27, 2), ...tap(27.5, 1, 27.5, 16)],
  },
  {
    id: "dusch",
    label: "Dusch",
    category: "badrum",
    size: [90, 90],
    // The glass screen swings out from the corner; the drain sits in the middle of the floor.
    paths: ["M89 1 A88 88 0 0 1 1 89", circle(30, 30, 3), ...tap(1, 14, 10, 14)],
  },
  {
    id: "badkar",
    label: "Badkar",
    category: "badrum",
    size: [170, 75],
    paths: [rect(1, 1, 168, 73), roundedRect(9, 9, 152, 57, 22), circle(146, 37.5, 3), ...tap(169, 37.5, 157, 37.5)],
  },
  {
    id: "handduk",
    label: "Handdukstork",
    category: "badrum",
    size: [60, 10],
    paths: [roundedRect(1, 1, 58, 8, 4), "M8 5 h44"],
  },
  {
    id: "spis",
    label: "Spis",
    category: "kök",
    size: [60, 60],
    // As on the reference plans: the hob split by a diagonal, burners and knobs in one half.
    paths: [
      rect(1, 1, 58, 58),
      "M1 1 L59 59",
      circle(15, 44, 8),
      circle(33, 49, 5),
      circle(11, 27, 4),
      circle(26, 56, 1),
      circle(31, 56, 1),
      circle(36, 56, 1),
    ],
  },
  {
    id: "diskho",
    label: "Diskho",
    category: "kök",
    size: [100, 60],
    paths: [
      rect(1, 1, 98, 58),
      roundedRect(8, 12, 46, 40, 5),
      roundedRect(62, 18, 30, 30, 5),
      circle(31, 32, 2.5),
      circle(77, 33, 2),
      ...tap(58, 1, 49, 20),
    ],
  },
  // A run of kitchen cabinets under the worktop: the counter's outline, nothing inside it.
  { id: "bankskiva", label: "Bänkskiva", category: "kök", size: [120, 60], paths: [rect(1, 1, 118, 58)] },
  { id: "kyl", label: "Kyl/Frys", category: "kök", size: [60, 60], text: "K/F", paths: labelledBox(60, 60) },
  { id: "diskmaskin", label: "Diskmaskin", category: "kök", size: [60, 60], text: "DM", paths: labelledBox(60, 60) },
  { id: "ugn", label: "Ugn/Mikro", category: "kök", size: [60, 60], text: "U/M", paths: labelledBox(60, 60) },
  { id: "tvatt", label: "Tvättmaskin", category: "el", size: [60, 60], text: "TM", paths: labelledBox(60, 60) },
  { id: "tork", label: "Torktumlare", category: "el", size: [60, 60], text: "TT", paths: labelledBox(60, 60) },
  { id: "garderob", label: "Garderob", category: "övrigt", size: [60, 60], text: "G", paths: labelledBox(60, 60) },
  {
    id: "el",
    label: "Eluttag",
    category: "el",
    size: [20, 20],
    paths: [circle(10, 10, 8), "M7.5 7 v6", "M12.5 7 v6"],
  },
  {
    id: "trad",
    label: "Trappa (symbol)",
    category: "övrigt",
    size: [100, 200],
    paths: [
      rect(1, 1, 98, 198),
      ...[25, 50, 75, 100, 125, 150, 175].map((y) => `M1 ${y} h98`),
      // Walking line and arrow pointing up the stair.
      "M50 188 V16",
      "M42 28 L50 16 L58 28",
    ],
  },
  {
    id: "dorr-symbol",
    label: "Dörr (symbol)",
    category: "övrigt",
    size: [90, 90],
    // Leaf standing open and the arc of its swing, as the reference doors are drawn.
    paths: ["M1 89 V1", "M1 1 A88 88 0 0 1 89 89"],
  },
];

export const FLOORPLAN_FURNITURE: FurnitureDefinition[] = [
  {
    id: "soffa",
    label: "Soffa",
    size: [200, 90],
    paths: [
      roundedRect(1, 1, 198, 88, 6),
      "M1 22 h198",
      "M22 22 v67",
      "M178 22 v67",
      "M74 22 v67",
      "M126 22 v67",
    ],
  },
  {
    id: "bord",
    label: "Bord",
    size: [120, 80],
    paths: [roundedRect(1, 1, 118, 78, 4)],
  },
  {
    id: "sang",
    label: "Säng",
    size: [160, 200],
    paths: [
      rect(1, 1, 158, 198),
      roundedRect(10, 10, 66, 30, 6),
      roundedRect(84, 10, 66, 30, 6),
      "M1 52 h158",
      "M1 66 h158",
    ],
  },
  {
    id: "stol",
    label: "Stol",
    size: [45, 45],
    paths: [roundedRect(4, 10, 37, 33, 4), roundedRect(4, 2, 37, 6, 3)],
  },
  {
    id: "skrivbord",
    label: "Skrivbord",
    size: [140, 70],
    paths: [rect(1, 1, 138, 68), "M100 1 v68", "M100 24 h39", "M100 46 h39"],
  },
];

/** Built to measure, so stretched to any length and depth rather than scaled: counters and wardrobes. */
export const STRETCHABLE_SYMBOL_IDS: ReadonlySet<string> = new Set(["bankskiva", "garderob"]);

export function getSymbolById(symbolId: string) {
  return FLOORPLAN_SYMBOLS.find((symbol) => symbol.id === symbolId) ?? null;
}

export function getFurnitureById(furnitureId: string) {
  return FLOORPLAN_FURNITURE.find((item) => item.id === furnitureId) ?? null;
}

/**
 * Size of an appliance's abbreviation in a box of this size: letters about a third of the box
 * tall, as on the reference plans, narrowed so three-letter codes (K/F, U/M) still fit.
 */
export function abbreviationFontSize(width: number, height: number, text: string) {
  return Math.min(height * 0.36, (width * 0.7) / (text.length * 0.6));
}

/**
 * The size of an abbreviation's letters on the plan: the size chosen for them, else fitted to the
 * box. Letters stand upright however the box is turned, so they are fitted, and held, to fit it
 * both along and across; a chosen size larger than that is held to the largest that fits.
 * Undefined for symbols without letters.
 */
export function abbreviationTextSize(symbol: {
  symbolId: string;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  textSize?: number;
}) {
  const text = getSymbolById(symbol.symbolId)?.text;
  if (!text) return undefined;
  const width = symbol.width * symbol.scaleX;
  const height = symbol.height * symbol.scaleY;
  const fitted = Math.min(abbreviationFontSize(width, height, text), abbreviationFontSize(height, width, text));
  const largest = Math.min(largestAbbreviationSize(width, height, text), largestAbbreviationSize(height, width, text));
  return symbol.textSize ? Math.min(symbol.textSize, largest) : fitted;
}

/** The largest letters that still fit inside the box, with a little room around them. */
function largestAbbreviationSize(width: number, height: number, text: string) {
  return Math.min(height * 0.8, (width * 0.9) / (text.length * 0.6));
}

/**
 * An abbreviation box turned to whatever quarter turn leaves its letters most level. Turning a box
 * a quarter turn is the same as swapping its sides, so the footprint is unchanged.
 */
export function uprightBox(width: number, height: number, rotation: number) {
  const quarters = Math.round(rotation / 90);
  const level = rotation - quarters * 90;
  return quarters % 2 === 0 ? { width, height, rotation: level } : { width: height, height: width, rotation: level };
}

/** Built-in pixel size of a hand-placed icon on a ~1200 px wide plan (0.8 px per cm). */
export function defaultIconSize(definition: { size: readonly [number, number] }) {
  return { width: definition.size[0] * 0.8, height: definition.size[1] * 0.8 };
}

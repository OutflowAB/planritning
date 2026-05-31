import type { FurnitureDefinition, FloorplanSymbolDefinition } from "@/lib/floorplan/types";

export const FLOORPLAN_SYMBOLS: FloorplanSymbolDefinition[] = [
  {
    id: "wc",
    label: "WC",
    category: "badrum",
    defaultWidth: 40,
    defaultHeight: 40,
    paths: [
      "M8 12 h24 v20 a12 12 0 0 1 -24 0 Z",
      "M14 8 h12 v6",
      "M20 22 v8",
    ],
  },
  {
    id: "dusch",
    label: "Dusch",
    category: "badrum",
    defaultWidth: 44,
    defaultHeight: 44,
    paths: [
      "M6 10 h32 v28 h-32 Z",
      "M10 14 v20 M16 14 v20 M22 14 v20 M28 14 v20",
    ],
  },
  {
    id: "badkar",
    label: "Badkar",
    category: "badrum",
    defaultWidth: 56,
    defaultHeight: 28,
    paths: ["M4 10 h48 a8 8 0 0 1 8 8 v4 h-56 v-4 a8 8 0 0 1 8 -8 Z"],
  },
  {
    id: "handduk",
    label: "Handdukstork",
    category: "badrum",
    defaultWidth: 24,
    defaultHeight: 36,
    paths: ["M6 6 h12 v28 h-12 Z", "M8 10 h8", "M8 16 h8", "M8 22 h8"],
  },
  {
    id: "spis",
    label: "Spis",
    category: "kök",
    defaultWidth: 48,
    defaultHeight: 48,
    paths: [
      "M6 6 h36 v36 h-36 Z",
      "M12 12 a4 4 0 1 0 0.01 0",
      "M28 12 a4 4 0 1 0 0.01 0",
      "M12 28 a4 4 0 1 0 0.01 0",
      "M28 28 a4 4 0 1 0 0.01 0",
    ],
  },
  {
    id: "diskho",
    label: "Diskho",
    category: "kök",
    defaultWidth: 44,
    defaultHeight: 28,
    paths: ["M4 8 h36 v16 h-36 Z", "M10 14 h24"],
  },
  {
    id: "kyl",
    label: "Kyl/Frys",
    category: "kök",
    defaultWidth: 36,
    defaultHeight: 36,
    paths: ["M8 4 h20 v32 h-20 Z", "M8 18 h20", "M14 10 v4", "M14 24 v4"],
  },
  {
    id: "tvatt",
    label: "Tvättmaskin",
    category: "el",
    defaultWidth: 36,
    defaultHeight: 36,
    paths: ["M6 6 h24 v24 h-24 Z", "M18 18 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0"],
  },
  {
    id: "tork",
    label: "Torktumlare",
    category: "el",
    defaultWidth: 36,
    defaultHeight: 36,
    paths: ["M6 6 h24 v24 h-24 Z", "M10 10 h16 v16 h-16 Z"],
  },
  {
    id: "el",
    label: "Eluttag",
    category: "el",
    defaultWidth: 20,
    defaultHeight: 20,
    paths: ["M4 10 h12", "M10 4 v12"],
  },
  {
    id: "trad",
    label: "Trappa (symbol)",
    category: "övrigt",
    defaultWidth: 48,
    defaultHeight: 48,
    paths: ["M6 38 h36", "M6 30 h36", "M6 22 h36", "M6 14 h36", "M6 6 h36"],
  },
  {
    id: "dorr-symbol",
    label: "Dörr (symbol)",
    category: "övrigt",
    defaultWidth: 40,
    defaultHeight: 40,
    paths: ["M6 34 h28", "M6 34 v-28", "M6 6 a28 28 0 0 1 28 28"],
  },
];

export const FLOORPLAN_FURNITURE: FurnitureDefinition[] = [
  {
    id: "soffa",
    label: "Soffa",
    defaultWidth: 80,
    defaultHeight: 36,
    paths: ["M4 10 h72 v18 h-72 Z", "M8 6 h64 v6 h-64 Z"],
  },
  {
    id: "bord",
    label: "Bord",
    defaultWidth: 56,
    defaultHeight: 56,
    paths: ["M8 8 h40 v40 h-40 Z"],
  },
  {
    id: "sang",
    label: "Säng",
    defaultWidth: 80,
    defaultHeight: 120,
    paths: ["M6 10 h68 v100 h-68 Z", "M6 30 h68"],
  },
  {
    id: "stol",
    label: "Stol",
    defaultWidth: 28,
    defaultHeight: 28,
    paths: ["M6 8 h16 v14 h-16 Z", "M8 22 v6", "M20 22 v6"],
  },
  {
    id: "skrivbord",
    label: "Skrivbord",
    defaultWidth: 72,
    defaultHeight: 36,
    paths: ["M4 10 h64 v6 h-64 Z", "M8 16 v12", "M60 16 v12"],
  },
];

export function getSymbolById(symbolId: string) {
  return FLOORPLAN_SYMBOLS.find((symbol) => symbol.id === symbolId) ?? null;
}

export function getFurnitureById(furnitureId: string) {
  return FLOORPLAN_FURNITURE.find((item) => item.id === furnitureId) ?? null;
}

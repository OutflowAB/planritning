import type { FloorplanDocument } from "@/lib/floorplan/types";

export type LibraryExportFormat = "pdf" | "png" | "jpg" | "svg";

export const LIBRARY_EXPORT_FORMATS: ReadonlyArray<{ format: LibraryExportFormat; label: string }> = [
  { format: "pdf", label: "PDF (A4)" },
  { format: "png", label: "PNG" },
  { format: "jpg", label: "JPG" },
  { format: "svg", label: "SVG" },
];

/** The plan as delivered: measurement lines are an editing aid, and the house style has none. */
export function printableDocument(document: FloorplanDocument): FloorplanDocument {
  return { ...document, objects: document.objects.filter((object) => object.type !== "dimension") };
}

const A4_LANDSCAPE_MM = { width: 297, height: 210 };
const PAGE_MARGIN_MM = 10;

/** Where an image of this size goes on an A4 landscape page: as large as fits, centred. */
export function fitToA4(width: number, height: number) {
  const room = { width: A4_LANDSCAPE_MM.width - 2 * PAGE_MARGIN_MM, height: A4_LANDSCAPE_MM.height - 2 * PAGE_MARGIN_MM };
  const scale = Math.min(room.width / width, room.height / height);
  const fitted = { width: width * scale, height: height * scale };
  return {
    x: (A4_LANDSCAPE_MM.width - fitted.width) / 2,
    y: (A4_LANDSCAPE_MM.height - fitted.height) / 2,
    ...fitted,
  };
}

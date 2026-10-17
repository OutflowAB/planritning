"use client";

import { jsPDF } from "jspdf";
import { Canvas, FabricText } from "fabric";

import { renderDocumentToCanvas } from "@/lib/floorplan/fabric/sync";
import { ApiError, apiFetch } from "@/lib/api-client";
import { fitToA4, type LibraryExportFormat, printableDocument } from "@/lib/floorplan/export-layout";
import { buildFloorplanImageUrl } from "@/lib/floorplan/image-url";
import type { FloorplanDocument } from "@/lib/floorplan/types";
import {
  houseAddressLine,
  houseTextLayout,
  SM_INK,
  SM_NOT_TO_SCALE,
  SM_ROOM_LABEL_FONT,
  SM_ROOM_LABEL_WEIGHT,
} from "@/lib/sm-floorplan-layout";

export type { LibraryExportFormat };

/** What every finished plan prints besides the drawing: its address and floor. */
export type HouseText = { address?: string | null; floorLabel?: string | null };

type ExportLibraryFloorplanInput = {
  imageId: number;
  imagePath: string;
  fileName: string;
  format: LibraryExportFormat;
  houseText: HouseText;
  /** The finished image, for plans finished before their document was kept. */
  fallbackUrl?: string | null;
};

export async function exportLibraryFloorplan(input: ExportLibraryFloorplanInput) {
  const document = await loadFloorplanDocument(input.imageId, input.imagePath);

  if (document) {
    await exportFromDocument(document, input);
    return;
  }

  if (!input.fallbackUrl) {
    throw new Error("Ingen bild att exportera.");
  }

  await exportFromImageUrl(input.fallbackUrl, input.format, input.fileName);
}

async function loadFloorplanDocument(
  imageId: number,
  imagePath: string,
): Promise<FloorplanDocument | null> {
  const params = new URLSearchParams({
    imageId: String(imageId),
    imagePath,
  });
  let response: Response;
  try {
    response = await apiFetch(`/api/floorplan-document?${params.toString()}`, { cache: "no-store" });
  } catch (error) {
    // No saved document is a normal state, not a failure.
    if (error instanceof ApiError && error.kind === "not-found") {
      return null;
    }
    throw error;
  }

  const data = (await response.json()) as {
    publishedDocument?: FloorplanDocument | null;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(data.message ?? "Kunde inte ladda planritningsdata.");
  }

  // Downloads are the plan as last finished, never edits made since.
  return data.publishedDocument ?? null;
}

async function exportFromDocument(
  floorplanDocument: FloorplanDocument,
  input: ExportLibraryFloorplanInput,
) {
  const canvas = await createDocumentRenderCanvas(floorplanDocument, input.imageId, input.imagePath, input.houseText);

  try {
    await exportCanvasToFormat(canvas, input.format, input.fileName);
  } finally {
    canvas.dispose();
  }
}

/** The finished plan's image, as stored by Slutför: the same drawing every download shows. */
export async function renderFloorplanDocumentToPngDataUrl(
  floorplanDocument: FloorplanDocument,
  imageId: number,
  imagePath: string,
  houseText: HouseText,
) {
  const canvas = await createDocumentRenderCanvas(floorplanDocument, imageId, imagePath, houseText);

  try {
    return canvas.toDataURL({ format: "png", multiplier: 1 });
  } finally {
    canvas.dispose();
  }
}

async function createDocumentRenderCanvas(
  floorplanDocument: FloorplanDocument,
  imageId: number,
  imagePath: string,
  houseText: HouseText,
) {
  const imageUrl = buildFloorplanImageUrl(imageId, imagePath);
  const canvasElement = window.document.createElement("canvas");
  const canvas = new Canvas(canvasElement, {
    width: floorplanDocument.canvas.width,
    height: floorplanDocument.canvas.height,
    renderOnAddRemove: false,
  });

  await renderDocumentToCanvas(canvas, printableDocument(floorplanDocument), imageUrl);
  addHouseText(canvas, houseText);
  canvas.renderAll();
  return canvas;
}

/** "INTE SKALENLIG" bottom-left and the address with its floor bottom-right, inside the frame. */
function addHouseText(canvas: Canvas, houseText: HouseText) {
  const layout = houseTextLayout(canvas.getWidth(), canvas.getHeight());
  const style = {
    fontFamily: SM_ROOM_LABEL_FONT,
    fontWeight: SM_ROOM_LABEL_WEIGHT,
    fontSize: layout.fontSize,
    fill: SM_INK,
    charSpacing: 60,
    originY: "bottom" as const,
    top: layout.baseline,
    selectable: false,
    evented: false,
  };
  canvas.add(new FabricText(SM_NOT_TO_SCALE, { ...style, originX: "left", left: layout.left }));
  const addressLine = houseAddressLine(houseText.address, houseText.floorLabel);
  if (addressLine) {
    canvas.add(new FabricText(addressLine, { ...style, originX: "right", left: layout.right }));
  }
}

/** An A4 landscape PDF with the image fitted inside the margins. */
function saveA4Pdf(pngDataUrl: string, width: number, height: number, fileName: string) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const placement = fitToA4(width, height);
  pdf.addImage(pngDataUrl, "PNG", placement.x, placement.y, placement.width, placement.height);
  pdf.save(fileName);
}

async function exportFromImageUrl(
  imageUrl: string,
  format: LibraryExportFormat,
  fileName: string,
) {
  const image = await loadImage(imageUrl);
  const canvasElement = window.document.createElement("canvas");
  canvasElement.width = image.naturalWidth;
  canvasElement.height = image.naturalHeight;

  const context = canvasElement.getContext("2d");
  if (!context) {
    throw new Error("Kunde inte skapa exportyta.");
  }

  context.drawImage(image, 0, 0);
  await exportHtmlCanvasToFormat(canvasElement, format, fileName);
}

async function loadImage(imageUrl: string) {
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Kunde inte ladda bilden.");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Kunde inte läsa bilden."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function exportCanvasToFormat(
  canvas: Canvas,
  format: LibraryExportFormat,
  fileName: string,
) {
  const safeName = sanitizeFileName(fileName);
  const width = canvas.getWidth();
  const height = canvas.getHeight();

  switch (format) {
    case "jpg": {
      downloadDataUrl(
        canvas.toDataURL({ format: "jpeg", quality: 0.92, multiplier: 2 }),
        `${safeName}.jpg`,
      );
      return;
    }
    case "png": {
      downloadDataUrl(canvas.toDataURL({ format: "png", multiplier: 2 }), `${safeName}.png`);
      return;
    }
    case "svg": {
      const blob = new Blob([canvas.toSVG()], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, `${safeName}.svg`);
      return;
    }
    case "pdf": {
      saveA4Pdf(canvas.toDataURL({ format: "png", multiplier: 2 }), width, height, `${safeName}.pdf`);
      return;
    }
    default:
      throw new Error(`Okänt exportformat: ${format satisfies never}`);
  }
}

async function exportHtmlCanvasToFormat(
  canvas: HTMLCanvasElement,
  format: LibraryExportFormat,
  fileName: string,
) {
  const safeName = sanitizeFileName(fileName);
  const width = canvas.width;
  const height = canvas.height;

  switch (format) {
    case "jpg": {
      downloadDataUrl(canvas.toDataURL("image/jpeg", 0.92), `${safeName}.jpg`);
      return;
    }
    case "png": {
      downloadDataUrl(canvas.toDataURL("image/png"), `${safeName}.png`);
      return;
    }
    case "svg": {
      const pngDataUrl = canvas.toDataURL("image/png");
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image width="${width}" height="${height}" xlink:href="${pngDataUrl}" />
</svg>`;
      downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeName}.svg`);
      return;
    }
    case "pdf": {
      saveA4Pdf(canvas.toDataURL("image/png"), width, height, `${safeName}.pdf`);
      return;
    }
    default:
      throw new Error(`Okänt exportformat: ${format satisfies never}`);
  }
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "") || "planritning";
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = window.document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

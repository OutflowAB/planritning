"use client";

import { jsPDF } from "jspdf";
import { Canvas } from "fabric";

import { renderDocumentToCanvas } from "@/lib/floorplan/fabric/sync";
import { ApiError, apiFetch } from "@/lib/api-client";
import { buildFloorplanImageUrl } from "@/lib/floorplan/image-url";
import type { FloorplanDocument } from "@/lib/floorplan/types";

export type LibraryExportFormat = "svg" | "pdf" | "jpg" | "jpeg";

type ExportLibraryFloorplanInput = {
  imageId: number;
  imagePath: string;
  fileName: string;
  format: LibraryExportFormat;
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
    document?: FloorplanDocument;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(data.message ?? "Kunde inte ladda planritningsdata.");
  }

  return data.document ?? null;
}

async function exportFromDocument(
  floorplanDocument: FloorplanDocument,
  input: ExportLibraryFloorplanInput,
) {
  const canvas = await createDocumentRenderCanvas(floorplanDocument, input.imageId, input.imagePath);

  try {
    await exportCanvasToFormat(canvas, input.format, input.fileName);
  } finally {
    canvas.dispose();
  }
}

export async function renderFloorplanDocumentToPngDataUrl(
  floorplanDocument: FloorplanDocument,
  imageId: number,
  imagePath: string,
) {
  const canvas = await createDocumentRenderCanvas(floorplanDocument, imageId, imagePath);

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
) {
  const imageUrl = buildFloorplanImageUrl(imageId, imagePath);
  const canvasElement = window.document.createElement("canvas");
  const canvas = new Canvas(canvasElement, {
    width: floorplanDocument.canvas.width,
    height: floorplanDocument.canvas.height,
    renderOnAddRemove: false,
  });

  await renderDocumentToCanvas(canvas, floorplanDocument, imageUrl);
  canvas.renderAll();
  return canvas;
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
    case "jpeg": {
      downloadDataUrl(
        canvas.toDataURL({ format: "jpeg", quality: 0.92, multiplier: 2 }),
        `${safeName}.jpeg`,
      );
      return;
    }
    case "svg": {
      const blob = new Blob([canvas.toSVG()], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, `${safeName}.svg`);
      return;
    }
    case "pdf": {
      const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
      const pdf = new jsPDF({
        orientation: width >= height ? "landscape" : "portrait",
        unit: "px",
        format: [width, height],
      });
      pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
      pdf.save(`${safeName}.pdf`);
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
    case "jpeg": {
      downloadDataUrl(canvas.toDataURL("image/jpeg", 0.92), `${safeName}.jpeg`);
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
      const dataUrl = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: width >= height ? "landscape" : "portrait",
        unit: "px",
        format: [width, height],
      });
      pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
      pdf.save(`${safeName}.pdf`);
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

import { jsPDF } from "jspdf";
import type { Canvas } from "fabric";

export type ExportFormat = "png" | "jpg" | "svg" | "pdf";

export async function exportCanvas(
  canvas: Canvas,
  format: ExportFormat,
  fileName: string,
): Promise<void> {
  const safeName = fileName.replace(/\.[^.]+$/, "") || "planritning";

  switch (format) {
    case "png": {
      const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
      downloadDataUrl(dataUrl, `${safeName}.png`);
      return;
    }
    case "jpg": {
      const dataUrl = canvas.toDataURL({ format: "jpeg", quality: 0.92, multiplier: 2 });
      downloadDataUrl(dataUrl, `${safeName}.jpg`);
      return;
    }
    case "svg": {
      const svg = canvas.toSVG();
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, `${safeName}.svg`);
      return;
    }
    case "pdf": {
      const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
      const pdf = new jsPDF({
        orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(dataUrl, "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`${safeName}.pdf`);
      return;
    }
    default:
      throw new Error(`Okänt exportformat: ${format satisfies never}`);
  }
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

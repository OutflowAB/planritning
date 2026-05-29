"use client";

import Image from "next/image";
import { Download, Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, TouchEvent, WheelEvent, useEffect, useRef, useState } from "react";

import {
  buildPlanritningarHref,
  clearPendingVerktygSave,
  setPendingVerktygSave,
} from "@/lib/verktyg-save-session";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

type ApprovedImageRow = {
  id: number;
  file_name: string;
  file_path: string;
  created_at: string;
  preview_url: string;
  is_saved: boolean;
};

function VerktygContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const imageIdParam = searchParams.get("imageId") ?? searchParams.get("previewImageId");
  const imagePathParam = searchParams.get("imagePath") ?? searchParams.get("previewImagePath");
  const [approvedImage, setApprovedImage] = useState<ApprovedImageRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  useEffect(() => {
    let active = true;

    async function loadApprovedImage() {
      setLoadError("");
      setApprovedImage(null);
      setZoom(1);

      if (!imageIdParam && !imagePathParam) {
        clearPendingVerktygSave();
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      const params = new URLSearchParams();
      if (imageIdParam) {
        params.set("imageId", imageIdParam);
      }
      if (imagePathParam) {
        params.set("imagePath", imagePathParam);
      }

      try {
        const response = await fetch(`/api/approved-generation?${params.toString()}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          message?: string;
          image?: ApprovedImageRow;
        };

        if (!active) {
          return;
        }

        if (!response.ok || !data.image?.preview_url) {
          clearPendingVerktygSave();
          setLoadError(data.message ?? "Kunde inte hämta den godkända bilden.");
          setIsLoading(false);
          return;
        }

        if (data.image.is_saved) {
          clearPendingVerktygSave();
        } else {
          setPendingVerktygSave({
            imageId: data.image.id,
            imagePath: data.image.file_path,
          });
        }

        setApprovedImage(data.image);
        setIsLoading(false);
      } catch {
        if (!active) {
          return;
        }
        clearPendingVerktygSave();
        setLoadError("Kunde inte hämta den godkända bilden just nu.");
        setIsLoading(false);
      }
    }

    void loadApprovedImage();

    return () => {
      active = false;
    };
  }, [imageIdParam, imagePathParam]);

  function zoomIn() {
    setZoom((previous) => Math.min(MAX_ZOOM, Number((previous + ZOOM_STEP).toFixed(2))));
  }

  function zoomOut() {
    setZoom((previous) => Math.max(MIN_ZOOM, Number((previous - ZOOM_STEP).toFixed(2))));
  }

  function resetZoom() {
    setZoom(1);
  }

  function getTouchDistance(
    touchA: Pick<TouchEvent<HTMLDivElement>["touches"][number], "clientX" | "clientY">,
    touchB: Pick<TouchEvent<HTMLDivElement>["touches"][number], "clientX" | "clientY">,
  ) {
    const deltaX = touchA.clientX - touchB.clientX;
    const deltaY = touchA.clientY - touchB.clientY;
    return Math.hypot(deltaX, deltaY);
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2) {
      return;
    }

    pinchStartDistanceRef.current = getTouchDistance(event.touches[0], event.touches[1]);
    pinchStartZoomRef.current = zoom;
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2 || !pinchStartDistanceRef.current) {
      return;
    }

    event.preventDefault();
    const currentDistance = getTouchDistance(event.touches[0], event.touches[1]);
    const relativeScale = currentDistance / pinchStartDistanceRef.current;
    const nextZoom = pinchStartZoomRef.current * relativeScale;
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    setZoom(Number(clampedZoom.toFixed(2)));
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length < 2) {
      pinchStartDistanceRef.current = null;
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const zoomDelta = -event.deltaY * 0.01;
    setZoom((previous) => {
      const next = previous + zoomDelta;
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      return Number(clamped.toFixed(2));
    });
  }

  async function downloadImage() {
    if (!approvedImage?.preview_url) {
      return;
    }

    setIsDownloading(true);
    try {
      const response = await fetch(approvedImage.preview_url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Download failed");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = approvedImage.file_name || "planritning";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch {
      setLoadError("Kunde inte ladda ner bilden just nu.");
    } finally {
      setIsDownloading(false);
    }
  }

  async function saveImage() {
    if (!approvedImage || isSaving) {
      return;
    }

    setIsSaving(true);
    setLoadError("");

    try {
      const response = await fetch("/api/save-generation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageId: approvedImage.id,
          filePath: approvedImage.file_path,
        }),
      });
      const data = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(data.message ?? "Kunde inte spara bilden just nu.");
      }

      clearPendingVerktygSave();
      window.dispatchEvent(new Event("library-updated"));
      router.push(
        buildPlanritningarHref(pathname, {
          imageId: approvedImage.id,
          imagePath: approvedImage.file_path,
        }),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Kunde inte spara bilden just nu.");
      setIsSaving(false);
    }
  }

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full flex-col bg-[#f5f3f0]">
      {approvedImage ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Zooma ut"
              className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Minus size={15} aria-hidden="true" />
            </button>
            <span className="w-14 text-center text-xs font-semibold text-[#6a6258]">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Zooma in"
              className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={resetZoom}
              aria-label="Återställ zoom"
              className="inline-flex h-8 items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
            >
              <RotateCcw size={13} aria-hidden="true" />
              Reset
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#6a6258]">Bild {approvedImage.id}</span>
            <button
              type="button"
              onClick={() => void downloadImage()}
              disabled={isDownloading}
              className="inline-flex h-8 items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={13} aria-hidden="true" />
              {isDownloading ? "Laddar..." : "Ladda ner"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 items-center justify-center overflow-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-[#6a6258]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Hämtar godkänd bild...
          </div>
        ) : null}

        {loadError ? (
          <p className="max-w-lg rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        ) : null}

        {!isLoading && !loadError && !approvedImage ? (
          <p className="max-w-lg text-center text-sm text-[#6a6258]">
            Ingen godkänd bild vald. Godkänn en genererad bild på startsidan för att fortsätta här.
          </p>
        ) : null}

        {approvedImage ? (
          <div
            className="touch-none select-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            onWheel={handleWheel}
          >
            <Image
              src={approvedImage.preview_url}
              alt={approvedImage.file_name}
              width={1600}
              height={1200}
              className="max-h-[calc(100vh-14rem)] w-auto max-w-full rounded-none border border-[#d8d2c8] bg-white object-contain transition-transform duration-150"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
            />
          </div>
        ) : null}
      </div>

      {approvedImage && !approvedImage.is_saved ? (
        <div className="sticky bottom-0 z-10 flex items-center justify-end border-t border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3">
          <button
            type="button"
            onClick={() => void saveImage()}
            disabled={isSaving}
            className="rounded-none bg-[#5c544a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Sparar..." : "Spara"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export default function VerktygPage() {
  return (
    <Suspense
      fallback={
        <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
          <div className="flex items-center gap-2 text-sm text-[#6a6258]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Laddar verktyg...
          </div>
        </section>
      }
    >
      <VerktygContent />
    </Suspense>
  );
}

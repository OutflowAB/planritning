"use client";

import Image from "next/image";
import { Check, Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChangeEvent,
  DragEvent,
  TouchEvent,
  WheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import {
  areCompareImagesCached,
  ImageCompareSlider,
  warmCompareImageCache,
  warmCompareImageSrc,
} from "@/components/dashboard/image-compare-slider";
import {
  preventImageContextMenu,
  WatermarkOverlay,
} from "@/components/dashboard/watermark-overlay";
import { useToast } from "@/components/ui/toast-provider";
import { readConvertStream } from "@/lib/floorplan/convert-stream";
import {
  imageDisplayName,
  resolveImageDownloadFileName,
} from "@/lib/image-naming";
import {
  CONVERTER_TRANSFER_KEY,
  hasPendingConverterTransfer,
} from "@/lib/startsida-converter-session";
import {
  clearPendingGenerationReview,
  getPendingGenerationReview,
  hasPendingGenerationReview,
  setPendingGenerationReview,
  subscribePendingGenerationReview,
} from "@/lib/startsida-review-session";
import {
  clearPendingSourceSelection,
  getPendingSourceSelection,
  hasPendingSourceSelection,
  setPendingSourceSelection,
} from "@/lib/startsida-source-session";
import { supabase } from "@/lib/supabase";
import {
  buildPlanritningarHref,
  buildVerktygHref,
  clearPendingVerktygSave,
} from "@/lib/verktyg-save-session";

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const UPLOADS_PREFIX = "uploads/";
const GENERATION_EVENTS_EVENT = "generation_events";
const LEGACY_GENERATION_EVENT = "generation-updated";
const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.5;
const PROCESSING_MAX_PROGRESS_PERCENT = 96;
/** Purely cosmetic cadence for the placeholder step list. It gates nothing. */
const PROCESSING_STEP_INTERVAL_MS = 2_500;
const PROCESSING_PROGRESS_TIME_CONSTANT_MS = 35_000;
const PROCESSING_TERMINAL_DURATION_MS = 15_000;
const PROCESSING_AI_ENHANCE_DURATION_MS = 5_000;
const PROCESSING_STEPS = [
  "Förbehandlar uppladdad bild",
  "Extraherar väggar och konturer",
  "Kartlägger rumsindelning",
  "Optimerar linjer och kontrast",
  "Exporterar slutresultat",
] as const;
const AI_ENHANCING_STEPS = [
  "AI förbättrar vägglinjer",
  "AI rensar bakgrundsbrus",
  "AI skärper rumsindelning",
  "AI polerar slutresultat",
] as const;

type TerminalLineType = "cmd" | "ok" | "info" | "warn" | "data";

type TerminalLine = {
  type: TerminalLineType;
  text: string;
};

function buildTerminalSequence(): TerminalLine[][] {
  const hash = () =>
    Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const coord = () => `${Math.floor(Math.random() * 2400)},${Math.floor(Math.random() * 1800)}`;
  const ms = () => `${(Math.random() * 400 + 12).toFixed(1)}ms`;

  return [
    [
      { type: "cmd", text: "> planritning-engine ingest --strict" },
      { type: "info", text: "[..] mounting buffer 4096×3072 RGBA" },
      { type: "ok", text: `[ok] decoded tile stream sha1:${hash()}` },
      { type: "info", text: "[..] EXIF rotate 90° CCW" },
      { type: "ok", text: `[ok] gamma normalize 2.2 (${ms()})` },
      { type: "data", text: `    chunks: 64 | vram: 312 MB` },
    ],
    [
      { type: "cmd", text: "> wall_scan --kernel=cuda:0" },
      { type: "info", text: "[..] launching Hough accumulator grid 128×128" },
      { type: "ok", text: `[ok] 1,247 edge candidates @ ${coord()}` },
      { type: "warn", text: `[!!] ghost wall suppressed sector 7 @ ${coord()}` },
      { type: "ok", text: "[ok] merged 3 duplicate partitions" },
      { type: "data", text: `    vectors: 89v / 112h | confidence 0.94` },
    ],
    [
      { type: "cmd", text: "> room_graph --build-adjacency" },
      { type: "info", text: "[..] flood-fill 12 connected components" },
      { type: "ok", text: `[ok] topology locked id:${hash()}` },
      { type: "warn", text: "[!!] non-manifold edge @ (891, 412) — patched" },
      { type: "ok", text: "[ok] 12 rooms classified, 1 excluded (balkong)" },
      { type: "data", text: `    graph nodes: 12 | edges: 31` },
    ],
    [
      { type: "cmd", text: "> line_pass --iter=4 --sharpen" },
      { type: "info", text: "[..] morphological open/close pass 1/4" },
      { type: "ok", text: `[ok] sharpened 2,341 vectors (${ms()})` },
      { type: "info", text: "[..] contrast stretch LUT applied" },
      { type: "ok", text: `[ok] noise floor -18dB @ ${coord()}` },
      { type: "data", text: `    SNR: 34.2 dB | artifacts: 0` },
    ],
    [
      { type: "cmd", text: "> export --format=png --dpi=300" },
      { type: "info", text: "[..] rasterizing 2480×3508 @ 300dpi" },
      { type: "ok", text: `[ok] deflate stream id:${hash()}` },
      { type: "ok", text: `[ok] checksum verified (${ms()})` },
      { type: "data", text: "    output: 4.1 MB | ready" },
      { type: "ok", text: "[ok] pipeline complete ✓" },
    ],
  ];
}

function terminalLineClass(type: TerminalLineType) {
  switch (type) {
    case "cmd":
      return "font-medium text-[#4d463f]";
    case "ok":
      return "text-[#5c544a]";
    case "warn":
      return "text-[#8b6914]";
    case "data":
      return "text-[#b8aea0]";
    default:
      return "text-[#7b746a]";
  }
}

function ProcessingTerminalLog({
  stepIndex,
  active,
}: {
  stepIndex: number;
  active: boolean;
}) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sequencesRef = useRef(buildTerminalSequence());
  const maxStepRef = useRef(0);
  const cursorRef = useRef({ step: 0, line: 0 });

  useEffect(() => {
    maxStepRef.current = Math.max(maxStepRef.current, stepIndex);
  }, [stepIndex]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const sequences = sequencesRef.current;

    const intervalId = window.setInterval(() => {
      const cursor = cursorRef.current;
      const maxStep = maxStepRef.current;

      while (cursor.step <= maxStep) {
        const stepLines = sequences[cursor.step];
        if (!stepLines || cursor.line >= stepLines.length) {
          cursor.step += 1;
          cursor.line = 0;
          continue;
        }

        const nextLine = stepLines[cursor.line];
        cursor.line += 1;
        setLines((previous) => [...previous, nextLine].slice(-24));
        break;
      }
    }, 380);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [active]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={scrollRef}
      className="h-40 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed"
      aria-label="Bearbetningslogg"
    >
      {lines.map((line, index) => (
        <div key={`${line.text}-${index}`} className={terminalLineClass(line.type)}>
          {line.text}
        </div>
      ))}
      <div className="text-[#5c544a]">
        <span className="animate-pulse">▊</span>
      </div>
    </div>
  );
}

type ConverterTransferPayload = {
  previewUrl: string;
  fileName?: string;
  uploadId?: number;
};

type ProcessingViewProps = {
  stepIndex: number;
  statusMessage?: string | null;
};

function ProcessingAiEnhancingSteps({ stepIndex }: { stepIndex: number }) {
  return (
    <ul className="space-y-2.5">
      {AI_ENHANCING_STEPS.map((step, index) => {
        const isComplete = index < stepIndex;
        const isActive = index === stepIndex;

        return (
          <li
            key={step}
            className={`flex items-center gap-2.5 text-sm transition-colors ${
              isComplete || isActive ? "text-[#4d463f]" : "text-[#b8aea0]"
            }`}
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {isComplete ? (
                <Check size={14} className="text-[#5c544a]" aria-hidden="true" />
              ) : isActive ? (
                <Loader2 size={14} className="animate-spin text-[#5c544a]" aria-hidden="true" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-[#d8d2c8]" aria-hidden="true" />
              )}
            </span>
            <span className={isActive ? "font-medium" : undefined}>{step}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ProcessingView({ stepIndex, statusMessage }: ProcessingViewProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const isAiPhase = elapsedMs >= PROCESSING_TERMINAL_DURATION_MS;
  const aiStepDuration = PROCESSING_AI_ENHANCE_DURATION_MS / AI_ENHANCING_STEPS.length;
  const aiStepIndex = isAiPhase
    ? Math.min(
        AI_ENHANCING_STEPS.length - 1,
        Math.floor((elapsedMs - PROCESSING_TERMINAL_DURATION_MS) / aiStepDuration),
      )
    : 0;
  // Generation takes anywhere from 30s to 2 minutes, so ease towards — but never reach — 100%.
  const progressPercent = Math.round(
    PROCESSING_MAX_PROGRESS_PERCENT * (1 - Math.exp(-elapsedMs / PROCESSING_PROGRESS_TIME_CONSTANT_MS)),
  );

  useEffect(() => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-[420px] flex-col items-center justify-center gap-8 px-6 py-12"
    >
      <Loader2 className="h-10 w-10 animate-spin text-[#5c544a]" aria-hidden="true" />

      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-lg font-semibold text-[#4d463f]">
            {isAiPhase ? "AI-förbättrar planritning" : "Bearbetar planritning"}
          </p>
          <p className="text-sm text-[#7b746a]">
            {statusMessage
              ? `${statusMessage}...`
              : isAiPhase
                ? `${AI_ENHANCING_STEPS[aiStepIndex]}...`
                : `${PROCESSING_STEPS[stepIndex]}...`}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-[#7b746a]">
            <span>Förlopp</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-none bg-[#e8e2d8]">
            <div
              className="h-full bg-[#5c544a] transition-all duration-700 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {isAiPhase ? (
          <ProcessingAiEnhancingSteps stepIndex={aiStepIndex} />
        ) : (
          <ProcessingTerminalLog stepIndex={stepIndex} active />
        )}
      </div>
    </div>
  );
}

function revokeIfObjectUrl(url: string | null) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Kunde inte läsa jämförelsebilden."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Kunde inte läsa jämförelsebilden."));
    reader.readAsDataURL(blob);
  });
}

async function rebuildCompareBeforePreview(sourcePreviewUrl: string, fileName?: string) {
  const sourceResponse = await fetch(sourcePreviewUrl, { cache: "no-store" });
  if (!sourceResponse.ok) {
    return null;
  }

  const sourceBlob = await sourceResponse.blob();
  const payload = new FormData();
  payload.append(
    "file",
    new File([sourceBlob], fileName ?? "planritning-kalla.jpg", {
      type: sourceBlob.type || "image/jpeg",
    }),
  );

  const compareResponse = await fetch("/api/compare-before", {
    method: "POST",
    body: payload,
  });

  if (!compareResponse.ok) {
    return null;
  }

  return blobToDataUrl(await compareResponse.blob());
}

function peekTransferredSourcePreview() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawPayload = window.sessionStorage.getItem(CONVERTER_TRANSFER_KEY);
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as ConverterTransferPayload;
    if (typeof parsed?.previewUrl !== "string" || parsed.previewUrl.length === 0) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function clearTransferredSourcePreview() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(CONVERTER_TRANSFER_KEY);
}

async function resolveUploadTransferPayload(uploadId: number): Promise<ConverterTransferPayload | null> {
  const { data, error } = await supabase
    .from(UPLOADS_TABLE)
    .select("id, file_name, file_path, mime_type")
    .eq("id", uploadId)
    .like("file_path", `${UPLOADS_PREFIX}%`)
    .single();

  if (error || !data?.file_path || !data.mime_type?.startsWith("image/")) {
    return null;
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(data.file_path, 3600);

  if (signError || !signedData?.signedUrl) {
    return null;
  }

  return {
    previewUrl: signedData.signedUrl,
    fileName: resolveImageDownloadFileName(data.id, {
      mimeType: data.mime_type,
      filePath: data.file_path,
    }),
    uploadId: data.id,
  };
}

function dataUrlToFile(dataUrl: string) {
  const [header, payload] = dataUrl.split(",");
  if (!header || !payload) {
    return null;
  }

  const mimeMatch = /^data:([^;]+);base64$/i.exec(header);
  if (!mimeMatch?.[1]) {
    return null;
  }

  const mime = mimeMatch[1];
  let binary: string;
  try {
    binary = window.atob(payload);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new File([bytes], "planritning-cached.png", { type: mime });
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Kunde inte läsa källbilden."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Kunde inte läsa källbilden."));
    reader.readAsDataURL(file);
  });
}

async function persistLocalSourceSelection(file: File) {
  try {
    const previewUrl = await fileToDataUrl(file);
    setPendingSourceSelection({
      previewUrl,
      fileName: file.name,
    });
  } catch {
    // Ignore quota or read errors — navigation restore may not work for very large files.
  }
}

function persistUploadSourceSelection(payload: ConverterTransferPayload) {
  if (typeof payload.uploadId === "number") {
    setPendingSourceSelection({
      uploadId: payload.uploadId,
      fileName: payload.fileName,
      ...(payload.previewUrl ? { previewUrl: payload.previewUrl } : {}),
    });
    return;
  }

  if (payload.previewUrl) {
    setPendingSourceSelection({
      previewUrl: payload.previewUrl,
      fileName: payload.fileName,
    });
  }
}

function readInitialSourcePreviewUrl(
  cachedReviewPreview: ReturnType<typeof readCachedReviewPreviewState>,
  cachedSourcePreview: ReturnType<typeof readCachedSourcePreviewState>,
) {
  if (cachedReviewPreview.sourcePreviewUrl) {
    return cachedReviewPreview.sourcePreviewUrl;
  }

  if (cachedSourcePreview.sourcePreviewUrl) {
    return cachedSourcePreview.sourcePreviewUrl;
  }

  return peekTransferredSourcePreview()?.previewUrl ?? null;
}

function readInitialSourceImageId(
  cachedReviewPreview: ReturnType<typeof readCachedReviewPreviewState>,
  cachedSourcePreview: ReturnType<typeof readCachedSourcePreviewState>,
) {
  if (cachedReviewPreview.sourceImageId) {
    return cachedReviewPreview.sourceImageId;
  }

  if (cachedSourcePreview.sourceImageId) {
    return cachedSourcePreview.sourceImageId;
  }

  const transferredUploadId = peekTransferredSourcePreview()?.uploadId;
  return typeof transferredUploadId === "number" ? transferredUploadId : null;
}

async function resolveSourceFileFromPreview(
  sourcePreviewUrl: string,
  fileName = "planritning.jpg",
) {
  if (sourcePreviewUrl.startsWith("data:")) {
    return dataUrlToFile(sourcePreviewUrl);
  }

  const response = await fetch(sourcePreviewUrl, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }

  const blob = await response.blob();
  return new File([blob], fileName, {
    type: blob.type || "image/jpeg",
  });
}

function useHasPendingGenerationReview() {
  return useSyncExternalStore(
    subscribePendingGenerationReview,
    () => hasPendingGenerationReview(),
    () => false,
  );
}

function readCachedReviewPreviewState() {
  const pendingReview = getPendingGenerationReview();
  if (!pendingReview) {
    return {
      hasPendingReview: false,
      hasCompletePreviewCache: false,
      resultImageId: null as number | null,
      resultImagePath: null as string | null,
      sourceImageId: null as number | null,
      sourcePreviewUrl: null as string | null,
      resultPreviewUrl: null as string | null,
      alignedSourcePreviewUrl: null as string | null,
    };
  }

  const sourcePreviewUrl =
    typeof pendingReview.sourcePreviewUrl === "string" && pendingReview.sourcePreviewUrl.length > 0
      ? pendingReview.sourcePreviewUrl
      : null;
  const resultPreviewUrl =
    typeof pendingReview.resultPreviewUrl === "string" && pendingReview.resultPreviewUrl.length > 0
      ? pendingReview.resultPreviewUrl
      : null;
  const alignedSourcePreviewUrl =
    typeof pendingReview.compareBeforePreviewUrl === "string" &&
    pendingReview.compareBeforePreviewUrl.length > 0
      ? pendingReview.compareBeforePreviewUrl
      : null;

  return {
    hasPendingReview: true,
    hasCompletePreviewCache: Boolean(sourcePreviewUrl && resultPreviewUrl && alignedSourcePreviewUrl),
    resultImageId: pendingReview.resultImageId,
    resultImagePath: pendingReview.resultImagePath,
    sourceImageId: pendingReview.sourceImageId,
    sourcePreviewUrl,
    resultPreviewUrl,
    alignedSourcePreviewUrl,
  };
}

function readCachedSourcePreviewState() {
  if (getPendingGenerationReview()) {
    return {
      hasPendingSource: false,
      hasCompleteSourceCache: true,
      sourcePreviewUrl: null as string | null,
      sourceFile: null as File | null,
      sourceImageId: null as number | null,
    };
  }

  const pendingSource = getPendingSourceSelection();
  if (!pendingSource) {
    return {
      hasPendingSource: false,
      hasCompleteSourceCache: true,
      sourcePreviewUrl: null as string | null,
      sourceFile: null as File | null,
      sourceImageId: null as number | null,
    };
  }

  if (pendingSource.previewUrl?.startsWith("data:")) {
    const sourceFile = dataUrlToFile(pendingSource.previewUrl);
    return {
      hasPendingSource: true,
      hasCompleteSourceCache: Boolean(sourceFile),
      sourcePreviewUrl: pendingSource.previewUrl,
      sourceFile,
      sourceImageId: null as number | null,
    };
  }

  if (pendingSource.previewUrl) {
    return {
      hasPendingSource: true,
      hasCompleteSourceCache: true,
      sourcePreviewUrl: pendingSource.previewUrl,
      sourceFile: null as File | null,
      sourceImageId:
        typeof pendingSource.uploadId === "number" ? pendingSource.uploadId : null,
    };
  }

  return {
    hasPendingSource: true,
    hasCompleteSourceCache: false,
    sourcePreviewUrl: null as string | null,
    sourceFile: null as File | null,
    sourceImageId:
      typeof pendingSource.uploadId === "number" ? pendingSource.uploadId : null,
  };
}

function ConverterLoadingShell() {
  return (
    <div
      className="mx-auto w-full max-w-3xl space-y-4 rounded-none border border-[#d8d2c8] bg-white p-5 text-left text-[#4d463f] shadow-sm"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#5c544a]" aria-hidden="true" />
      </div>
    </div>
  );
}

function ComparePreviewSkeleton({ showWatermark = false }: { showWatermark?: boolean }) {
  return (
    <div
      className="flex min-h-[420px] w-full items-center justify-center bg-[#f0ece6] px-6 py-8"
      aria-busy="true"
      aria-live="polite"
      aria-label="Jämförelsebilden laddas"
    >
      <div className="relative h-[min(60vh,640px)] w-full max-w-2xl animate-pulse rounded-none bg-[#e0dbd3]">
        {showWatermark ? <WatermarkOverlay /> : null}
      </div>
    </div>
  );
}

export function FloorplanEnhancer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isPendingGenerationReview = useHasPendingGenerationReview();
  const cachedReviewPreview = readCachedReviewPreviewState();
  const cachedSourcePreview = readCachedSourcePreviewState();
  const [hasRestoredPendingReview, setHasRestoredPendingReview] = useState(
    () => !cachedReviewPreview.hasPendingReview || cachedReviewPreview.hasCompletePreviewCache,
  );
  const [hasRestoredPendingSource, setHasRestoredPendingSource] = useState(
    () =>
      !cachedSourcePreview.hasPendingSource ||
      cachedSourcePreview.hasCompleteSourceCache ||
      Boolean(readInitialSourcePreviewUrl(cachedReviewPreview, cachedSourcePreview)),
  );
  const [sourceFile, setSourceFile] = useState<File | null>(() => cachedSourcePreview.sourceFile);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(() =>
    readInitialSourcePreviewUrl(cachedReviewPreview, cachedSourcePreview),
  );
  const [alignedSourcePreviewUrl, setAlignedSourcePreviewUrl] = useState<string | null>(
    () => cachedReviewPreview.alignedSourcePreviewUrl,
  );
  const [resultPreviewUrl, setResultPreviewUrl] = useState<string | null>(
    () => cachedReviewPreview.resultPreviewUrl,
  );
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingStepIndex, setProcessingStepIndex] = useState(0);
  const [processingStatusMessage, setProcessingStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [resultImageId, setResultImageId] = useState<number | null>(
    () => cachedReviewPreview.resultImageId,
  );
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showApproveDestinationModal, setShowApproveDestinationModal] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false);
  const { showToast } = useToast();
  const [resultImagePath, setResultImagePath] = useState<string | null>(
    () => cachedReviewPreview.resultImagePath,
  );
  const [sourceImageId, setSourceImageId] = useState<number | null>(() =>
    readInitialSourceImageId(cachedReviewPreview, cachedSourcePreview),
  );
  const [previewImageType, setPreviewImageType] = useState<"source" | "result" | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isCompareSliderReady, setIsCompareSliderReady] = useState(() =>
    Boolean(
      cachedReviewPreview.alignedSourcePreviewUrl &&
        cachedReviewPreview.resultPreviewUrl &&
        areCompareImagesCached(
          cachedReviewPreview.alignedSourcePreviewUrl,
          cachedReviewPreview.resultPreviewUrl,
        ),
    ),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const [sectionOverlayTarget, setSectionOverlayTarget] = useState<HTMLElement | null>(null);

  const hasSourcePreview = Boolean(sourcePreviewUrl);
  const showDropzone = !hasSourcePreview;
  const protectResultPreview = isPendingGenerationReview && Boolean(resultPreviewUrl);
  const activePreviewImageUrl =
    previewImageType === "source"
      ? sourcePreviewUrl
      : previewImageType === "result"
        ? resultPreviewUrl
        : null;
  const clearFromUploadQuery = useCallback(() => {
    if (!searchParams.has("fromUpload")) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("fromUpload");
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const applyTransferredSource = useCallback(
    (transferredSource: ConverterTransferPayload) => {
      setErrorMessage("");
      setSourceImageId(
        typeof transferredSource.uploadId === "number" ? transferredSource.uploadId : null,
      );
      setSourceFile(null);
      setSourcePreviewUrl((previous) => {
        revokeIfObjectUrl(previous);
        return transferredSource.previewUrl;
      });
      clearTransferredSourcePreview();
      clearFromUploadQuery();
      persistUploadSourceSelection(transferredSource);
    },
    [clearFromUploadQuery],
  );


  useEffect(() => {
    return () => {
      revokeIfObjectUrl(sourcePreviewUrl);
    };
  }, [sourcePreviewUrl]);

  useEffect(() => {
    return () => {
      revokeIfObjectUrl(resultPreviewUrl);
    };
  }, [resultPreviewUrl]);

  useEffect(() => {
    if (!isSubmitting) {
      setProcessingStepIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setProcessingStepIndex((previous) =>
        previous < PROCESSING_STEPS.length - 1 ? previous + 1 : previous,
      );
    }, PROCESSING_STEP_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isSubmitting]);

  function clearGenerationResult() {
    clearPendingGenerationReview();
    setPreviewImageType(null);
    setPreviewZoom(1);
    setResultImageId(null);
    setResultImagePath(null);
    setShowRejectForm(false);
    setShowApproveDestinationModal(false);
    setSectionOverlayTarget(null);
    setRejectComment("");
    setIsReviewSubmitting(false);
    setAlignedSourcePreviewUrl(null);
    setIsCompareSliderReady(false);
    setResultPreviewUrl((prev) => {
      revokeIfObjectUrl(prev);

      return null;
    });
  }

  function resetResult() {
    clearGenerationResult();
  }

  function resetSourceSelection() {
    clearPendingSourceSelection();
    setErrorMessage("");
    setIsSubmitting(false);
    setSourceFile(null);
    setSourceImageId(null);
    setIsDragActive(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setSourcePreviewUrl((prev) => {
      revokeIfObjectUrl(prev);
      return null;
    });
    resetResult();
  }

  useLayoutEffect(() => {
    if (cachedReviewPreview.alignedSourcePreviewUrl) {
      warmCompareImageSrc(cachedReviewPreview.alignedSourcePreviewUrl);
    }

    if (cachedReviewPreview.alignedSourcePreviewUrl && cachedReviewPreview.resultPreviewUrl) {
      warmCompareImageCache(
        cachedReviewPreview.alignedSourcePreviewUrl,
        cachedReviewPreview.resultPreviewUrl,
      );
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function restorePendingReview() {
      const pendingReview = getPendingGenerationReview();
      if (!pendingReview) {
        setHasRestoredPendingReview(true);
        return;
      }

      if (cachedReviewPreview.hasCompletePreviewCache) {
        void (async () => {
          try {
            const [sourcePayload, signedResult] = await Promise.all([
              resolveUploadTransferPayload(pendingReview.sourceImageId),
              supabase.storage
                .from(BUCKET_NAME)
                .createSignedUrl(pendingReview.resultImagePath, 3600),
            ]);

            if (isCancelled) {
              return;
            }

            if (
              !sourcePayload?.previewUrl ||
              signedResult.error ||
              !signedResult.data?.signedUrl
            ) {
              // Supabase answered, and the image is not there. The cached previews point at a
              // deleted object or carry an expired token, so showing them yields a broken
              // image and a review that can never be submitted.
              clearGenerationResult();

              if (!sourcePayload?.previewUrl) {
                // The original upload is gone too, so there is nothing left to convert.
                clearPendingSourceSelection();
                setSourceFile(null);
                setSourceImageId(null);
                setSourcePreviewUrl((previous) => {
                  revokeIfObjectUrl(previous);
                  return null;
                });
              }

              setErrorMessage(
                "Den här bilden finns inte kvar. Ladda upp planritningen och konvertera på nytt.",
              );
              return;
            }

            setSourcePreviewUrl((previous) => {
              if (previous === sourcePayload.previewUrl) {
                return previous;
              }

              revokeIfObjectUrl(previous);
              return sourcePayload.previewUrl;
            });
            setResultPreviewUrl((previous) => {
              if (previous === signedResult.data.signedUrl) {
                return previous;
              }

              revokeIfObjectUrl(previous);
              return signedResult.data.signedUrl;
            });
            setPendingGenerationReview({
              ...pendingReview,
              sourcePreviewUrl: sourcePayload.previewUrl,
              resultPreviewUrl: signedResult.data.signedUrl,
            });
          } catch {
            // Keep cached previews visible if background refresh fails.
          }
        })();
        return;
      }

      setErrorMessage("");

      try {
        const [sourcePayload, signedResult] = await Promise.all([
          resolveUploadTransferPayload(pendingReview.sourceImageId),
          supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(pendingReview.resultImagePath, 3600),
        ]);

        if (isCancelled) {
          return;
        }

        if (!sourcePayload?.previewUrl || signedResult.error || !signedResult.data?.signedUrl) {
          clearPendingGenerationReview();
          setErrorMessage("Kunde inte återställa granskningen. Starta om konverteringen.");
          return;
        }

        setSourceImageId(pendingReview.sourceImageId);
        setSourcePreviewUrl((previous) => {
          revokeIfObjectUrl(previous);
          return sourcePayload.previewUrl;
        });
        setResultImageId(pendingReview.resultImageId);
        setResultImagePath(pendingReview.resultImagePath);
        setResultPreviewUrl((previous) => {
          revokeIfObjectUrl(previous);
          return signedResult.data.signedUrl;
        });

        const restoredComparePreview =
          pendingReview.compareBeforePreviewUrl ??
          (await rebuildCompareBeforePreview(
            sourcePayload.previewUrl,
            sourcePayload.fileName,
          ));
        setAlignedSourcePreviewUrl(restoredComparePreview);
        if (restoredComparePreview) {
          warmCompareImageCache(restoredComparePreview, signedResult.data.signedUrl);
          setPendingGenerationReview({
            ...pendingReview,
            compareBeforePreviewUrl: restoredComparePreview,
            sourcePreviewUrl: sourcePayload.previewUrl,
            resultPreviewUrl: signedResult.data.signedUrl,
          });
        }
      } catch {
        if (!isCancelled) {
          clearPendingGenerationReview();
          setErrorMessage("Kunde inte återställa granskningen. Starta om konverteringen.");
        }
      } finally {
        if (!isCancelled) {
          setHasRestoredPendingReview(true);
        }
      }
    }

    void restorePendingReview();
    return () => {
      isCancelled = true;
    };
  }, [cachedReviewPreview.hasCompletePreviewCache]);

  const isRestoringPendingReview = isPendingGenerationReview && !hasRestoredPendingReview;
  const isRestoringPendingSource = hasPendingSourceSelection() && !hasRestoredPendingSource;
  const showGenerationReview =
    Boolean(resultPreviewUrl && sourcePreviewUrl) || isRestoringPendingReview;
  const isComparePreviewLoading =
    showGenerationReview && (!resultPreviewUrl || !sourcePreviewUrl || !alignedSourcePreviewUrl);
  const isCompareReviewReady = Boolean(
    alignedSourcePreviewUrl && resultPreviewUrl && isCompareSliderReady,
  );

  const handleCompareSliderReadyChange = useCallback((ready: boolean) => {
    setIsCompareSliderReady(ready);
  }, []);

  useEffect(() => {
    if (alignedSourcePreviewUrl && resultPreviewUrl) {
      warmCompareImageCache(alignedSourcePreviewUrl, resultPreviewUrl);
    }
  }, [alignedSourcePreviewUrl, resultPreviewUrl]);

  useEffect(() => {
    let isCancelled = false;

    async function restorePendingSourceSelection() {
      if (getPendingGenerationReview()) {
        setHasRestoredPendingSource(true);
        return;
      }

      if (hasPendingConverterTransfer(searchParams.get("fromUpload"))) {
        setHasRestoredPendingSource(true);
        return;
      }

      if (cachedSourcePreview.hasCompleteSourceCache) {
        return;
      }

      const pendingSource = getPendingSourceSelection();
      if (!pendingSource) {
        setHasRestoredPendingSource(true);
        return;
      }

      setErrorMessage("");

      try {
        if (typeof pendingSource.uploadId === "number") {
          const payload = await resolveUploadTransferPayload(pendingSource.uploadId);
          if (!payload?.previewUrl) {
            clearPendingSourceSelection();
            return;
          }

          applyTransferredSource(payload);
          return;
        }

        if (pendingSource.previewUrl?.startsWith("data:")) {
          const restoredFile = dataUrlToFile(pendingSource.previewUrl);
          if (!restoredFile) {
            clearPendingSourceSelection();
            return;
          }

          setSourceFile(restoredFile);
          setSourceImageId(null);
          setSourcePreviewUrl((previous) => {
            revokeIfObjectUrl(previous);
            return pendingSource.previewUrl ?? null;
          });
          return;
        }

        clearPendingSourceSelection();
      } catch {
        if (!isCancelled) {
          clearPendingSourceSelection();
          setErrorMessage("Kunde inte återställa vald bild. Välj bilden igen.");
        }
      } finally {
        if (!isCancelled) {
          setHasRestoredPendingSource(true);
        }
      }
    }

    void restorePendingSourceSelection();
    return () => {
      isCancelled = true;
    };
  }, [applyTransferredSource, searchParams]);

  useEffect(() => {
    let isCancelled = false;

    async function hydrateTransferredSource() {
      if (getPendingGenerationReview()) {
        return;
      }

      if (!hasPendingConverterTransfer(searchParams.get("fromUpload"))) {
        return;
      }

      let transferredSource = peekTransferredSourcePreview();

      if (!transferredSource) {
        const fromUploadParam = searchParams.get("fromUpload");
        const fromUploadId =
          fromUploadParam && !Number.isNaN(Number(fromUploadParam)) ? Number(fromUploadParam) : null;

        if (fromUploadId) {
          transferredSource = await resolveUploadTransferPayload(fromUploadId);
        }
      }

      if (transferredSource?.previewUrl) {
        applyTransferredSource(transferredSource);
      }
    }

    void hydrateTransferredSource();
    return () => {
      isCancelled = true;
    };
  }, [applyTransferredSource, searchParams]);

  function assignFile(file: File | null) {
    if (!file) {
      return;
    }

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setErrorMessage("Välj en PNG, JPG eller WEBP-fil.");
      return;
    }

    setErrorMessage("");
    setSourceFile(file);
    setSourceImageId(null);
    setSourcePreviewUrl((prev) => {
      revokeIfObjectUrl(prev);
      return URL.createObjectURL(file);
    });
    resetResult();
    void persistLocalSourceSelection(file);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    assignFile(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    assignFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);
  }

  async function processImage(file?: File) {
    if (isSubmitting) {
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);
    setProcessingStepIndex(0);
    setProcessingStatusMessage(null);

    try {
      let resolvedFile = file ?? sourceFile;
      if (!resolvedFile && sourcePreviewUrl) {
        const pendingSource = getPendingSourceSelection();
        resolvedFile = await resolveSourceFileFromPreview(
          sourcePreviewUrl,
          pendingSource?.fileName ?? "planritning.jpg",
        );
        if (resolvedFile) {
          setSourceFile(resolvedFile);
        }
      }

      if (!resolvedFile) {
        throw new Error("Kunde inte läsa bilden igen. Ladda upp bilden på nytt.");
      }

      const payload = new FormData();
      payload.append("file", resolvedFile);
      if (sourceImageId) {
        payload.append("sourceImageId", String(sourceImageId));
      }

      const response = await fetch("/api/convert", {
        method: "POST",
        body: payload,
      });

      if (!response.ok) {
        const fallbackMessage = "Kunde inte bearbeta bilden. Försök igen.";
        let resolvedMessage = fallbackMessage;
        try {
          const data = (await response.json()) as { message?: string };
          if (data?.message) {
            resolvedMessage = data.message;
          }
        } catch {
          // Ignore JSON parse issues and use fallback message.
        }
        throw new Error(resolvedMessage);
      }

      const conversion = await readConvertStream(response, {
        onStatus: (event) => setProcessingStatusMessage(event.message),
      });

      const parsedSavedImageId = conversion.savedImageId;
      const parsedSourceImageId = conversion.sourceImageId;
      const savedImagePath = conversion.savedImagePath;
      if (parsedSourceImageId) {
        setSourceImageId(parsedSourceImageId);
      }
      setResultImageId(parsedSavedImageId);
      setResultImagePath(savedImagePath);
      const compareBeforeDataUrl = conversion.compareBefore;
      setAlignedSourcePreviewUrl(compareBeforeDataUrl);
      const nextResultPreviewUrl = conversion.savedImageUrl || conversion.result;
      warmCompareImageCache(compareBeforeDataUrl, nextResultPreviewUrl);
      setResultPreviewUrl((prev) => {
        revokeIfObjectUrl(prev);
        return nextResultPreviewUrl;
      });
      if (parsedSavedImageId && savedImagePath && parsedSourceImageId) {
        clearPendingSourceSelection();
        setPendingGenerationReview({
          resultImageId: parsedSavedImageId,
          resultImagePath: savedImagePath,
          sourceImageId: parsedSourceImageId,
          compareBeforePreviewUrl: compareBeforeDataUrl,
          sourcePreviewUrl: sourcePreviewUrl ?? undefined,
          resultPreviewUrl: nextResultPreviewUrl,
        });
      }
      window.dispatchEvent(new Event("library-updated"));
      window.dispatchEvent(new Event(GENERATION_EVENTS_EVENT));
      window.dispatchEvent(new Event(LEGACY_GENERATION_EVENT));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ett oväntat fel uppstod.");
    } finally {
      setIsSubmitting(false);
      setProcessingStatusMessage(null);
    }
  }

  function startConversion() {
    if (isSubmitting) {
      return;
    }

    void processImage();
  }

  async function submitGenerationReview(
    action: "approve" | "reject",
    destination?: "verktyg" | "planritningar",
  ) {
    if (isReviewSubmitting || !resultImageId || !resultImagePath) {
      return;
    }

    const trimmedComment = rejectComment.trim();
    if (action === "reject" && !trimmedComment) {
      setErrorMessage("Skriv en kommentar om varför bilden nekas.");
      return;
    }

    setErrorMessage("");
    setIsReviewSubmitting(true);

    try {
      const response = await fetch("/api/review-generation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          imageId: resultImageId,
          filePath: resultImagePath,
          ...(action === "reject" ? { comment: trimmedComment } : {}),
        }),
      });

      if (!response.ok) {
        // The image is gone from the database, so the cached review can never be resolved.
        // Clear it instead of leaving the user on a dead form with a broken preview.
        if (response.status === 404) {
          clearGenerationResult();
          setErrorMessage(
            "Den här bilden finns inte kvar. Ladda upp planritningen och konvertera på nytt.",
          );
          return;
        }

        const fallbackMessage =
          action === "approve"
            ? "Kunde inte godkänna bilden just nu."
            : "Kunde inte neka bilden just nu.";
        let resolvedMessage = fallbackMessage;
        try {
          const data = (await response.json()) as { message?: string };
          if (data?.message) {
            resolvedMessage = data.message;
          }
        } catch {
          // Ignore JSON parse issues and use fallback message.
        }
        throw new Error(resolvedMessage);
      }

      if (action === "approve") {
        if (destination === "planritningar") {
          const saveResponse = await fetch("/api/save-generation", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              imageId: resultImageId,
              filePath: resultImagePath,
            }),
          });

          if (!saveResponse.ok) {
            let resolvedMessage = "Kunde inte spara bilden i planritningar just nu.";
            try {
              const data = (await saveResponse.json()) as { message?: string };
              if (data?.message) {
                resolvedMessage = data.message;
              }
            } catch {
              // Ignore JSON parse issues and use fallback message.
            }
            throw new Error(resolvedMessage);
          }

          clearPendingVerktygSave();
          clearPendingGenerationReview();
          setShowRejectForm(false);
          setShowApproveDestinationModal(false);
          setSectionOverlayTarget(null);
          setRejectComment("");
          window.dispatchEvent(new Event("library-updated"));
          window.dispatchEvent(new Event(GENERATION_EVENTS_EVENT));
          window.dispatchEvent(new Event(LEGACY_GENERATION_EVENT));
          router.push(
            buildPlanritningarHref(pathname, {
              imageId: resultImageId,
              imagePath: resultImagePath,
            }),
          );
          return;
        }

        clearPendingGenerationReview();
        setShowRejectForm(false);
        setShowApproveDestinationModal(false);
        setSectionOverlayTarget(null);
        setRejectComment("");
        router.push(
          buildVerktygHref(pathname, {
            imageId: resultImageId,
            imagePath: resultImagePath,
          }),
        );
        return;
      }

      resetSourceSelection();
      showToast("Ditt meddelande är skickat.");
      window.dispatchEvent(new Event("library-updated"));
      window.dispatchEvent(new Event(GENERATION_EVENTS_EVENT));
      window.dispatchEvent(new Event(LEGACY_GENERATION_EVENT));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ett oväntat fel uppstod.");
    } finally {
      setIsReviewSubmitting(false);
    }
  }

  function openApproveDestinationModal() {
    setErrorMessage("");
    setSectionOverlayTarget(rootRef.current?.closest("section") ?? null);
    setShowApproveDestinationModal(true);
  }

  function closeApproveDestinationModal() {
    if (isReviewSubmitting) {
      return;
    }

    setShowApproveDestinationModal(false);
    setSectionOverlayTarget(null);
  }

  function openRejectForm() {
    setErrorMessage("");
    setShowRejectForm(true);
  }

  function cancelRejectForm() {
    setShowRejectForm(false);
    setRejectComment("");
    setErrorMessage("");
  }

  function leavePreview() {
    if (isSubmitting) {
      return;
    }

    resetSourceSelection();
  }

  function openSourcePreview() {
    if (!sourcePreviewUrl) {
      return;
    }

    setPreviewZoom(1);
    setPreviewImageType("source");
  }

  function openResultPreview() {
    if (!resultPreviewUrl) {
      return;
    }

    setPreviewZoom(1);
    setPreviewImageType("result");
  }

  function closeImagePreview() {
    setPreviewZoom(1);
    setPreviewImageType(null);
  }

  function zoomPreviewIn() {
    setPreviewZoom((previous) =>
      Math.min(MAX_PREVIEW_ZOOM, Number((previous + PREVIEW_ZOOM_STEP).toFixed(2))),
    );
  }

  function zoomPreviewOut() {
    setPreviewZoom((previous) =>
      Math.max(MIN_PREVIEW_ZOOM, Number((previous - PREVIEW_ZOOM_STEP).toFixed(2))),
    );
  }

  function resetPreviewZoom() {
    setPreviewZoom(1);
  }

  function getTouchDistance(
    touchA: Pick<TouchEvent<HTMLDivElement>["touches"][number], "clientX" | "clientY">,
    touchB: Pick<TouchEvent<HTMLDivElement>["touches"][number], "clientX" | "clientY">,
  ) {
    const deltaX = touchA.clientX - touchB.clientX;
    const deltaY = touchA.clientY - touchB.clientY;
    return Math.hypot(deltaX, deltaY);
  }

  function handlePreviewTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2) {
      return;
    }

    pinchStartDistanceRef.current = getTouchDistance(event.touches[0], event.touches[1]);
    pinchStartZoomRef.current = previewZoom;
  }

  function handlePreviewTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2 || !pinchStartDistanceRef.current) {
      return;
    }

    event.preventDefault();
    const currentDistance = getTouchDistance(event.touches[0], event.touches[1]);
    const relativeScale = currentDistance / pinchStartDistanceRef.current;
    const nextZoom = pinchStartZoomRef.current * relativeScale;
    const clampedZoom = Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, nextZoom));
    setPreviewZoom(Number(clampedZoom.toFixed(2)));
  }

  function handlePreviewTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length < 2) {
      pinchStartDistanceRef.current = null;
    }
  }

  function handlePreviewWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const zoomDelta = -event.deltaY * 0.01;
    setPreviewZoom((previous) => {
      const next = previous + zoomDelta;
      const clamped = Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, next));
      return Number(clamped.toFixed(2));
    });
  }

  useEffect(() => {
    if (!previewImageType && !showApproveDestinationModal) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (showApproveDestinationModal) {
        closeApproveDestinationModal();
        return;
      }

      closeImagePreview();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [previewImageType, showApproveDestinationModal, isReviewSubmitting]);

  if (isRestoringPendingSource && !showGenerationReview) {
    return <ConverterLoadingShell />;
  }

  const approveDestinationModal = showApproveDestinationModal ? (
    <div
      className={`${sectionOverlayTarget ? "absolute" : "fixed"} inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6`}
      onClick={closeApproveDestinationModal}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-none border border-[#d8d2c8] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-labelledby="approve-destination-title"
        aria-describedby="approve-destination-description"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
          <h2 id="approve-destination-title" className="text-sm font-semibold text-[#4d463f]">
            Planritningen är klar
          </h2>
          <button
            type="button"
            onClick={closeApproveDestinationModal}
            disabled={isReviewSubmitting}
            aria-label="Stäng"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="px-4 py-4">
          <p id="approve-destination-description" className="text-sm text-[#6a6258]">
            Fortsätt redigera om du vill göra fler ändringar, eller spara planritningen direkt.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
          <button
            type="button"
            onClick={() => void submitGenerationReview("approve", "verktyg")}
            disabled={isReviewSubmitting}
            className="inline-flex min-w-[157px] items-center justify-center rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isReviewSubmitting ? "Sparar..." : "Redigera"}
          </button>
          <button
            type="button"
            onClick={() => void submitGenerationReview("approve", "planritningar")}
            disabled={isReviewSubmitting}
            className="inline-flex min-w-[157px] items-center justify-center rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isReviewSubmitting ? "Sparar..." : "Spara"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className="mx-auto w-full max-w-3xl space-y-4 rounded-none border border-[#d8d2c8] bg-white p-5 text-left text-[#4d463f] shadow-sm"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="sr-only"
        onChange={handleFileInputChange}
      />

      {isSubmitting ? (
        <ProcessingView stepIndex={processingStepIndex} statusMessage={processingStatusMessage} />
      ) : (
        <>
          {showDropzone ? (
            <label
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => {
                fileInputRef.current?.click();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              tabIndex={0}
              className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-none border-2 border-dashed px-6 py-8 text-center transition ${
                isDragActive
                  ? "border-[#b8aea0] bg-[#f2ede5]"
                  : "border-[#d8d2c8] bg-[#faf8f4] hover:border-[#b8aea0]"
              }`}
            >
              <p className="text-sm font-medium text-[#5c544a]">
                Dra och släpp en planritning här, eller klicka för att välja fil.
              </p>
              <p className="mt-2 text-xs text-[#7b746a]">Stöd: PNG, JPG, WEBP</p>
            </label>
          ) : null}

          {errorMessage ? (
            <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}

          {sourcePreviewUrl ? (
        <div className="space-y-3">
          {!resultPreviewUrl ? (
            <figure className="mx-auto w-fit max-w-full overflow-hidden rounded-none border border-[#d8d2c8] bg-white">
              <figcaption className="flex items-center justify-between gap-3 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#7b746a]">Original</span>
                <div className="flex items-center gap-2">
                  {sourceImageId ? (
                    <span className="text-xs font-semibold text-[#6a6258]">
                      {imageDisplayName(sourceImageId)}
                    </span>
                  ) : null}
                  <button
                  type="button"
                  onClick={leavePreview}
                  disabled={isSubmitting}
                  aria-label="Lämna bildvy"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X size={14} aria-hidden="true" />
                </button>
                </div>
              </figcaption>
              <Image
                src={sourcePreviewUrl}
                alt="Original planritning"
                width={1200}
                height={1200}
                unoptimized
                onClick={openSourcePreview}
                className="h-auto w-auto max-h-[min(60vh,640px)] max-w-full cursor-zoom-in bg-white"
              />
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
                {errorMessage ? (
                  <button
                    type="button"
                    onClick={startConversion}
                    disabled={isSubmitting || !sourcePreviewUrl}
                    className="rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Försök igen
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={startConversion}
                  disabled={isSubmitting || !sourcePreviewUrl}
                  className="inline-flex min-w-[157px] items-center justify-center rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Konverterar..." : "Starta konvertering"}
                </button>
              </div>
            </figure>
          ) : null}

          {showGenerationReview ? (
            <figure
              className={`mx-auto overflow-hidden rounded-none border border-[#d8d2c8] bg-white leading-none ${
                isCompareReviewReady ? "w-fit max-w-full" : "w-full max-w-3xl"
              }`}
            >
              <figcaption className="flex items-center justify-between gap-3 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#7b746a]">
                  Före / Efter
                </span>
                {resultImageId ? (
                  <span className="text-xs font-semibold text-[#6a6258]">{imageDisplayName(resultImageId)}</span>
                ) : null}
              </figcaption>
              {isComparePreviewLoading ? (
                <ComparePreviewSkeleton showWatermark={protectResultPreview} />
              ) : alignedSourcePreviewUrl && resultPreviewUrl ? (
                <ImageCompareSlider
                  beforeSrc={alignedSourcePreviewUrl}
                  afterSrc={resultPreviewUrl}
                  beforeAlt="Original planritning"
                  afterAlt="Bearbetad planritning"
                  protectAfterImage={protectResultPreview}
                  loadingFallback={<ComparePreviewSkeleton showWatermark={protectResultPreview} />}
                  onReadyChange={handleCompareSliderReadyChange}
                />
              ) : null}
              {isCompareReviewReady && alignedSourcePreviewUrl && showRejectForm ? (
                <div className="space-y-3 border-t border-[#e8e2d8] bg-[#f7f4ef] px-4 py-4">
                  <p className="text-sm font-medium text-[#5c544a]">
                    Berätta varför bilden nekas så att vi kan förbättra resultatet.
                  </p>
                  <textarea
                    value={rejectComment}
                    onChange={(event) => setRejectComment(event.target.value)}
                    rows={3}
                    placeholder="Skriv din kommentar här..."
                    disabled={isReviewSubmitting}
                    className="w-full resize-y rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm text-[#4d463f] outline-none transition focus:border-[#b8aea0] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={cancelRejectForm}
                      disabled={isReviewSubmitting}
                      className="rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Avbryt
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitGenerationReview("reject")}
                      disabled={isReviewSubmitting || !rejectComment.trim()}
                      className="inline-flex min-w-[157px] items-center justify-center rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isReviewSubmitting ? "Skickar..." : "Skicka"}
                    </button>
                  </div>
                </div>
              ) : isCompareReviewReady && alignedSourcePreviewUrl ? (
                <div className="border-t border-[#e8e2d8] bg-[#f7f4ef] px-4 py-4">
                  <p className="mb-3 text-center text-sm font-medium text-[#5c544a]">
                    Godkänner du den bearbetade bilden?
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={openRejectForm}
                      disabled={isReviewSubmitting}
                      className="inline-flex min-w-[157px] items-center justify-center gap-1.5 rounded-none border border-[#d8d2c8] bg-white px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Neka
                      <X size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={openApproveDestinationModal}
                      disabled={isReviewSubmitting}
                      className="inline-flex min-w-[157px] items-center justify-center gap-1.5 rounded-none border border-[#5c544a] bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Godkänn
                      <Check size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : null}
            </figure>
          ) : null}
        </div>
      ) : null}
        </>
      )}

      {sectionOverlayTarget && approveDestinationModal
        ? createPortal(approveDestinationModal, sectionOverlayTarget)
        : approveDestinationModal}

      {previewImageType && activePreviewImageUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={closeImagePreview}
          role="presentation"
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-none border border-[#d8d2c8] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={zoomPreviewOut}
                  disabled={previewZoom <= MIN_PREVIEW_ZOOM}
                  aria-label="Zooma ut"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Minus size={15} aria-hidden="true" />
                </button>
                <span className="w-14 text-center text-xs font-semibold text-[#6a6258]">
                  {Math.round(previewZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={zoomPreviewIn}
                  disabled={previewZoom >= MAX_PREVIEW_ZOOM}
                  aria-label="Zooma in"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={resetPreviewZoom}
                  aria-label="Återställ zoom"
                  className="inline-flex h-8 items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  Reset
                </button>
              </div>

              <button
                type="button"
                onClick={closeImagePreview}
                aria-label="Stäng bildvisning"
                className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5]"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-[#f0ece6] p-4">
              <div className="mx-auto flex min-h-full w-full items-center justify-center">
                <div
                  className="relative touch-none select-none transition-transform duration-150"
                  style={{ transform: `scale(${previewZoom})`, transformOrigin: "center center" }}
                  onTouchStart={handlePreviewTouchStart}
                  onTouchMove={handlePreviewTouchMove}
                  onTouchEnd={handlePreviewTouchEnd}
                  onTouchCancel={handlePreviewTouchEnd}
                  onWheel={handlePreviewWheel}
                  onContextMenu={
                    protectResultPreview && previewImageType === "result"
                      ? preventImageContextMenu
                      : undefined
                  }
                >
                  <Image
                    src={activePreviewImageUrl}
                    alt={
                      previewImageType === "source"
                        ? "Original planritning i förhandsvisning"
                        : "Bearbetad planritning i förhandsvisning"
                    }
                    width={2200}
                    height={1600}
                    unoptimized
                    draggable={false}
                    className="h-auto max-h-[calc(90vh-190px)] w-auto max-w-full border border-[#d8d2c8] bg-white object-contain"
                  />
                  {protectResultPreview && previewImageType === "result" ? (
                    <WatermarkOverlay />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

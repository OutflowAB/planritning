"use client";

import Image from "next/image";
import { DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

type Phase = "idle" | "preview" | "processing" | "done";
type DownloadFormat = "png" | "jpg" | "jpeg" | "webp";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOWNLOAD_FORMATS: DownloadFormat[] = ["png", "jpg", "jpeg", "webp"];
const GENERATIONS_TABLE = "generation_events";
const UPLOADS_TABLE = "uploaded_images";
const BUCKET_NAME = "planritningar";

export function FloorplanConverter() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [jobId, setJobId] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState(
    "Processing… (this may take 1–3 minutes)",
  );
  const [saveMessage, setSaveMessage] = useState("");

  const eventSourceRef = useRef<EventSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const downloadContainerRef = useRef<HTMLDivElement | null>(null);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!logsContainerRef.current) {
      return;
    }
    logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!downloadContainerRef.current) {
        return;
      }
      if (event.target instanceof Node && !downloadContainerRef.current.contains(event.target)) {
        setIsDownloadOpen(false);
      }
    }

    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  const canConvert = useMemo(
    () => Boolean(selectedFile) && !isUploading && phase !== "processing",
    [isUploading, phase, selectedFile],
  );

  function clearActiveStream() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  function resetAllState() {
    clearActiveStream();
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setPhase("idle");
    setSelectedFile(null);
    setPreviewUrl("");
    setJobId("");
    setResultUrl("");
    setIsDragging(false);
    setIsUploading(false);
    setIsDownloadOpen(false);
    setErrorMessage("");
    setSaveMessage("");
    setLogs([]);
    setStatusMessage("Processing… (this may take 1–3 minutes)");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleFile(file: File) {
    setErrorMessage("");
    if (!ALLOWED_TYPES.includes(file.type)) {
      setErrorMessage("Unsupported file type. Please use JPG, PNG, or WebP.");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setPhase("preview");
  }

  async function handleConvert() {
    if (!selectedFile) {
      return;
    }

    setErrorMessage("");
    setLogs([]);
    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", selectedFile);

    let uploadResponse: Response;
    try {
      uploadResponse = await fetch("/api/floorplan/upload", {
        method: "POST",
        body: formData,
      });
    } catch {
      setErrorMessage("Upload failed — kunde inte nå konverteringsservern.");
      setIsUploading(false);
      return;
    }

    const uploadPayload = (await uploadResponse.json()) as {
      job_id?: string;
      error?: string;
    };

    if (!uploadResponse.ok || !uploadPayload.job_id) {
      setErrorMessage(uploadPayload.error ?? "Upload error");
      setIsUploading(false);
      return;
    }

    const uploadedJobId = uploadPayload.job_id;
    setJobId(uploadedJobId);
    setPhase("processing");
    setIsUploading(false);
    openStream(uploadedJobId);
  }

  function openStream(streamJobId: string) {
    clearActiveStream();

    const stream = new EventSource(`/api/floorplan/stream/${streamJobId}`);
    eventSourceRef.current = stream;

    stream.addEventListener("log", (event) => {
      const message = (event as MessageEvent).data;
      setLogs((previous) => [...previous, message]);
    });

    stream.addEventListener("done", () => {
      clearActiveStream();
      setResultUrl(`/api/floorplan/result/${streamJobId}?t=${Date.now()}`);
      setPhase("done");
      void registerGeneration();
      void saveConvertedImageToLibrary(streamJobId);
    });

    stream.addEventListener("error", (event) => {
      const message = (event as MessageEvent).data as string | undefined;
      if (!message) {
        return;
      }

      clearActiveStream();
      setErrorMessage(message || "Processing failed — check server logs.");
      setPhase("preview");
    });

    stream.onerror = () => {
      if (!eventSourceRef.current) {
        return;
      }
      clearActiveStream();
      setErrorMessage("Lost connection to server.");
      setPhase("preview");
    };
  }

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  async function registerGeneration() {
    const { error } = await supabase.from(GENERATIONS_TABLE).insert({
      created_at: new Date().toISOString(),
    });

    if (error) {
      return;
    }

    window.dispatchEvent(new Event("generation-updated"));
  }

  async function saveConvertedImageToLibrary(doneJobId: string) {
    setSaveMessage("");

    let resultResponse: Response;
    try {
      resultResponse = await fetch(`/api/floorplan/result/${doneJobId}`, {
        method: "GET",
        cache: "no-store",
      });
    } catch {
      setErrorMessage(
        "Konverteringen är klar men bilden kunde inte hämtas för biblioteket.",
      );
      return;
    }

    if (!resultResponse.ok) {
      setErrorMessage(
        "Konverteringen är klar men bilden kunde inte sparas i biblioteket.",
      );
      return;
    }

    const imageBlob = await resultResponse.blob();
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}.png`;
    const storagePath = `generated/${uniqueName}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, imageBlob, {
        upsert: false,
        contentType: "image/png",
      });

    if (uploadError) {
      setErrorMessage(
        `Konverteringen är klar men bibliotekssparning misslyckades: ${uploadError.message}`,
      );
      return;
    }

    const { error: insertError } = await supabase.from(UPLOADS_TABLE).insert({
      file_name: `floorplan_converted_${new Date().toISOString()}.png`,
      file_path: storagePath,
      file_size: imageBlob.size,
      mime_type: "image/png",
    });

    if (insertError) {
      await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
      setErrorMessage(
        `Konverteringen är klar men metadata kunde inte sparas: ${insertError.message}`,
      );
      return;
    }

    setSaveMessage("Bilden är sparad i Bibliotek.");
    window.dispatchEvent(new Event("library-updated"));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }

  function handleDownload(format: DownloadFormat) {
    if (!jobId) {
      return;
    }
    setIsDownloadOpen(false);
    const link = document.createElement("a");
    link.href = `/api/floorplan/download/${jobId}?format=${format}`;
    link.download = `floorplan_converted.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="mx-auto w-full max-w-2xl rounded-none bg-white p-8 shadow-[0_4px_32px_rgba(61,48,40,0.10)]">
      {phase !== "processing" && phase !== "done" ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (!selectedFile) {
              triggerFilePicker();
            }
          }}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !selectedFile) {
              event.preventDefault();
              triggerFilePicker();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`relative cursor-pointer rounded-none border-2 border-dashed px-6 py-10 text-center transition ${
            isDragging
              ? "border-[#8b7355] bg-[#f0ebe5]"
              : "border-[#c9bdb4] bg-[#faf7f5]"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                handleFile(file);
              }
            }}
          />

          {previewUrl ? (
            <Image
              src={previewUrl}
              alt="Preview"
              width={1200}
              height={900}
              unoptimized
              className="mx-auto mt-4 block max-h-[300px] w-auto max-w-full object-contain"
            />
          ) : (
            <div>
              <p className="text-[15px] leading-relaxed text-[#7a6a60]">
                Drag &amp; drop your floor plan here
              </p>
              <p className="text-[15px] leading-relaxed text-[#7a6a60]">
                or{" "}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    triggerFilePicker();
                  }}
                  className="cursor-pointer bg-transparent p-0 text-[15px] font-semibold text-[#3d3028] underline"
                >
                  browse files
                </button>
              </p>
              <p className="mt-2 text-xs text-[#b0a098]">JPG · PNG · WebP</p>
            </div>
          )}
        </div>
      ) : null}

      {phase === "preview" ? (
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleConvert()}
            disabled={!canConvert}
            className="flex flex-1 items-center justify-center gap-2 rounded-none bg-[#3d3028] px-8 py-3 text-[15px] font-semibold text-white transition hover:bg-[#2a1f18] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isUploading ? (
              <span className="h-4 w-4 animate-spin rounded-none border-2 border-white/35 border-t-white" />
            ) : null}
            <span>{isUploading ? "Uploading…" : "Convert"}</span>
          </button>
          <button
            type="button"
            onClick={resetAllState}
            className="rounded-none px-2 py-3 text-sm text-[#8b7355] underline"
          >
            Use different file
          </button>
        </div>
      ) : null}

      {phase === "processing" ? (
        <div className="mt-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-7 w-7 animate-spin rounded-none border-[3px] border-[#e1d5c9] border-t-[#3d3028]" />
            <span className="text-sm font-medium text-[#3d3028]">{statusMessage}</span>
          </div>
          <div className="mb-3 h-1 w-full overflow-hidden rounded-none bg-[#e1d5c9]">
            <div className="h-full w-[40%] animate-[indeterminate_1.6s_ease-in-out_infinite] bg-[#3d3028]" />
          </div>
          <div
            ref={logsContainerRef}
            className="max-h-[200px] overflow-y-auto rounded-none border border-[#e1d5c9] bg-[#faf7f5] px-4 py-3 font-mono text-xs leading-relaxed text-[#7a6a60] whitespace-pre-wrap"
          >
            {logs.length > 0 ? logs.join("\n") : "Starting conversion pipeline..."}
          </div>
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="mt-5">
          <Image
            src={resultUrl}
            alt="Converted floor plan"
            width={1600}
            height={1200}
            unoptimized
            className="block h-auto w-full rounded-none shadow-[0_4px_20px_rgba(61,48,40,0.12)]"
          />
          <div className="mt-4 flex gap-3">
            <div ref={downloadContainerRef} className="relative flex-1">
              <button
                type="button"
                onClick={() => setIsDownloadOpen((previous) => !previous)}
                className="flex w-full items-center justify-center gap-2 rounded-none bg-[#3d3028] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2a1f18]"
              >
                <span>Download</span>
                <span
                  className={`h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-white transition ${
                    isDownloadOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isDownloadOpen ? (
                <div className="absolute left-0 right-0 top-full z-10 border border-[#c9bdb4] bg-white shadow-[0_4px_12px_rgba(61,48,40,0.15)]">
                  {DOWNLOAD_FORMATS.map((format) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => handleDownload(format)}
                      className="block w-full border-b border-[#f0ebe5] px-4 py-3 text-left text-sm text-[#3d3028] transition hover:bg-[#f5f0eb] last:border-b-0"
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={resetAllState}
              className="rounded-none border border-[#c9bdb4] px-4 py-3 text-sm text-[#7a6a60] transition hover:border-[#8b7355] hover:text-[#3d3028]"
            >
              Convert another
            </button>
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mt-4 rounded-none bg-[#fce8e8] px-4 py-3 text-sm leading-relaxed text-[#c0392b]">
          {errorMessage}
        </div>
      ) : null}

      {saveMessage ? (
        <div className="mt-4 rounded-none border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-700">
          {saveMessage}
        </div>
      ) : null}

      <style jsx>{`
        @keyframes indeterminate {
          0% {
            transform: translateX(-100%);
            width: 40%;
          }
          50% {
            width: 60%;
          }
          100% {
            transform: translateX(280%);
            width: 40%;
          }
        }
      `}</style>
    </div>
  );
}

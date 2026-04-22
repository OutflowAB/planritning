"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

type Phase = "idle" | "preview" | "processing" | "done";
type DownloadFormat = "png" | "jpg" | "jpeg" | "webp";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOWNLOAD_FORMATS: DownloadFormat[] = ["png", "jpg", "jpeg", "webp"];
const GENERATIONS_TABLE = "generation_events";
const UPLOADS_TABLE = "uploaded_images";
const BUCKET_NAME = "planritningar";
const CONVERTER_STATE_STORAGE_KEY = "floorplan-converter-state-v1";

type PersistedConverterState = {
  phase: Phase;
  jobId: string;
  logs: string[];
  statusMessage: string;
  errorMessage: string;
};

function revokeObjectPreviewUrl(url: string) {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export function FloorplanConverter() {
  const searchParams = useSearchParams();
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
    "Bearbetar… (vanligtvis 20–90 sekunder)",
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const downloadContainerRef = useRef<HTMLDivElement | null>(null);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const isHydratedRef = useRef(false);
  const preloadedPathRef = useRef<string>("");

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (previewUrl) {
        revokeObjectPreviewUrl(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    const imagePath = searchParams.get("imagePath");
    const imagePreviewUrl = searchParams.get("imagePreviewUrl");
    if (!imagePath || imagePath === preloadedPathRef.current) {
      return;
    }
    const selectedImagePath = imagePath;
    preloadedPathRef.current = selectedImagePath;

    if (imagePreviewUrl) {
      setErrorMessage("");
      setPreviewUrl(imagePreviewUrl);
      setPhase("preview");
    }

    let isCancelled = false;

    async function preloadFileFromLibrary() {
      let sourceUrl = imagePreviewUrl;
      if (!sourceUrl) {
        const { data, error } = await supabase.storage
          .from(BUCKET_NAME)
          .createSignedUrl(selectedImagePath, 3600);

        if (isCancelled) {
          return;
        }

        if (error || !data?.signedUrl) {
          setErrorMessage("Kunde inte läsa vald bild från biblioteket.");
          return;
        }

        sourceUrl = data.signedUrl;
      }
      if (!sourceUrl) {
        return;
      }

      let response: Response;
      try {
        response = await fetch(sourceUrl, { cache: "force-cache" });
      } catch {
        if (!isCancelled) {
          setErrorMessage("Kunde inte hämta vald bild för konvertering.");
        }
        return;
      }

      if (isCancelled || !response.ok) {
        return;
      }

      const blob = await response.blob();
      const fallbackName = selectedImagePath.split("/").pop() ?? "uppladdad-bild";
      const fileName = searchParams.get("imageName") || fallbackName;
      const fileType = blob.type || "image/png";
      const file = new File([blob], fileName, { type: fileType });

      handleFile(file);
    }

    void preloadFileFromLibrary();

    return () => {
      isCancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    if (!logsContainerRef.current) {
      return;
    }
    logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    try {
      const rawState = window.sessionStorage.getItem(CONVERTER_STATE_STORAGE_KEY);
      if (!rawState) {
        return;
      }

      const persistedState = JSON.parse(rawState) as PersistedConverterState;
      if (!persistedState?.jobId) {
        window.sessionStorage.removeItem(CONVERTER_STATE_STORAGE_KEY);
        return;
      }

      setJobId(persistedState.jobId);
      setLogs(Array.isArray(persistedState.logs) ? persistedState.logs : []);
      setStatusMessage(
        persistedState.statusMessage || "Bearbetar… (vanligtvis 20–90 sekunder)",
      );
      setErrorMessage(persistedState.errorMessage || "");

      if (persistedState.phase === "processing") {
        setPhase("processing");
        openStream(persistedState.jobId);
        return;
      }

      if (persistedState.phase === "done") {
        setPhase("done");
        setResultUrl(`/api/floorplan/result/${persistedState.jobId}?t=${Date.now()}`);
        return;
      }

      window.sessionStorage.removeItem(CONVERTER_STATE_STORAGE_KEY);
    } catch {
      window.sessionStorage.removeItem(CONVERTER_STATE_STORAGE_KEY);
    } finally {
      isHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!isHydratedRef.current) {
      return;
    }

    try {
      if (phase !== "processing" && phase !== "done") {
        window.sessionStorage.removeItem(CONVERTER_STATE_STORAGE_KEY);
        return;
      }

      const stateToPersist: PersistedConverterState = {
        phase,
        jobId,
        logs,
        statusMessage,
        errorMessage,
      };
      window.sessionStorage.setItem(
        CONVERTER_STATE_STORAGE_KEY,
        JSON.stringify(stateToPersist),
      );
    } catch {
      // Ignore storage errors to avoid blocking conversion UI.
    }
  }, [errorMessage, jobId, logs, phase, statusMessage]);

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
      revokeObjectPreviewUrl(previewUrl);
    }
    window.sessionStorage.removeItem(CONVERTER_STATE_STORAGE_KEY);

    setPhase("idle");
    setSelectedFile(null);
    setPreviewUrl("");
    setJobId("");
    setResultUrl("");
    setIsDragging(false);
    setIsUploading(false);
    setIsDownloadOpen(false);
    setErrorMessage("");
    setLogs([]);
    setStatusMessage("Bearbetar… (vanligtvis 20–90 sekunder)");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleFile(file: File) {
    setErrorMessage("");
    if (!ALLOWED_TYPES.includes(file.type)) {
      setErrorMessage("Filtypen stöds inte. Använd JPG, PNG eller WebP.");
      return;
    }

    if (previewUrl) {
      revokeObjectPreviewUrl(previewUrl);
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
      setErrorMessage("Uppladdning misslyckades — kunde inte starta lokal konvertering.");
      setIsUploading(false);
      return;
    }

    const uploadPayload = (await uploadResponse.json()) as {
      job_id?: string;
      error?: string;
    };

    if (!uploadResponse.ok || !uploadPayload.job_id) {
      setErrorMessage(uploadPayload.error ?? "Uppladdningsfel");
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
      setErrorMessage(message || "Bearbetningen misslyckades — kontrollera loggen.");
      setPhase("preview");
    });

    stream.onerror = () => {
      if (!eventSourceRef.current) {
        return;
      }
      clearActiveStream();
      setErrorMessage("Förlorade anslutningen till konverteringsflödet.");
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
              alt="Förhandsvisning"
              width={1200}
              height={900}
              unoptimized
              className="mx-auto mt-4 block max-h-[300px] w-auto max-w-full object-contain"
            />
          ) : (
            <div>
              <p className="text-[15px] leading-relaxed text-[#7a6a60]">
                Dra och släpp din planritning här
              </p>
              <p className="text-[15px] leading-relaxed text-[#7a6a60]">
                eller{" "}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    triggerFilePicker();
                  }}
                  className="cursor-pointer bg-transparent p-0 text-[15px] font-semibold text-[#3d3028] underline"
                >
                  bläddra bland filer
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
            onClick={resetAllState}
            className="rounded-none px-2 py-3 text-sm text-[#8b7355] underline"
          >
            Välj en annan fil
          </button>
          <button
            type="button"
            onClick={() => void handleConvert()}
            disabled={!canConvert}
            className="flex flex-1 items-center justify-center gap-2 rounded-none bg-[#3d3028] px-8 py-3 text-[15px] font-semibold text-white transition hover:bg-[#2a1f18] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isUploading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
            ) : null}
            <span>{isUploading ? "Laddar upp…" : "Konvertera"}</span>
          </button>
        </div>
      ) : null}

      {phase === "processing" ? (
        <div className="mt-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#e1d5c9] border-t-[#3d3028]" />
            <span className="text-sm font-medium text-[#3d3028]">{statusMessage}</span>
          </div>
          <div className="mb-3 h-1 w-full overflow-hidden rounded-none bg-[#e1d5c9]">
            <div className="h-full w-[40%] animate-[indeterminate_1.6s_ease-in-out_infinite] bg-[#3d3028]" />
          </div>
          <div
            ref={logsContainerRef}
            className="max-h-[200px] overflow-y-auto rounded-none border border-[#e1d5c9] bg-[#faf7f5] px-4 py-3 font-mono text-xs leading-relaxed text-[#7a6a60] whitespace-pre-wrap"
          >
            {logs.length > 0 ? logs.join("\n") : "Startar konverteringsflöde..."}
          </div>
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="mt-5">
          <Image
            src={resultUrl}
            alt="Konverterad planritning"
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
                <span>Ladda ner</span>
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
              Konvertera en till
            </button>
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mt-4 rounded-none bg-[#fce8e8] px-4 py-3 text-sm leading-relaxed text-[#c0392b]">
          {errorMessage}
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

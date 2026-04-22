"use client";

import Image from "next/image";
import { Loader2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";

type UploadResult = {
  fileName: string;
  path: string;
  uploadedAt: string;
};

type UploadedImageRow = {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string | null;
  created_at: string;
  preview_url?: string | null;
};

export default function UppladdningarPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingUploads, setIsLoadingUploads] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [success, setSuccess] = useState("");
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null);
  const [uploads, setUploads] = useState<UploadedImageRow[]>([]);

  async function loadUploads() {
    setLoadError("");
    setIsLoadingUploads(true);

    const { data, error: queryError } = await supabase
      .from(UPLOADS_TABLE)
      .select("id, file_name, file_path, file_size, mime_type, created_at")
      .order("created_at", { ascending: false });

    if (queryError) {
      setLoadError(`Kunde inte hämta uppladdningar: ${queryError.message}`);
      setIsLoadingUploads(false);
      return;
    }

    const rows = (data as UploadedImageRow[]) ?? [];
    const imagePaths = rows
      .filter((row) => row.mime_type?.startsWith("image/"))
      .map((row) => row.file_path);

    const previewByPath = new Map<string, string>();

    if (imagePaths.length > 0) {
      const { data: signedData } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrls(imagePaths, 3600);

      signedData?.forEach((item, index) => {
        if (item?.signedUrl) {
          previewByPath.set(imagePaths[index], item.signedUrl);
        }
      });
    }

    const rowsWithPreview = rows.map((row) => ({
      ...row,
      preview_url: previewByPath.get(row.file_path) ?? null,
    }));

    setUploads(rowsWithPreview);
    setIsLoadingUploads(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUploads();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!selectedFile) {
      setError("Välj en bildfil först.");
      return;
    }

    setIsUploading(true);

    try {
      const extension = selectedFile.name.split(".").pop() ?? "jpg";
      const uniqueName = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const storagePath = `uploads/${uniqueName}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, selectedFile, {
          upsert: false,
          contentType: selectedFile.type,
        });

      if (uploadError) {
        setError(`Uppladdning misslyckades: ${uploadError.message}`);
        return;
      }

      const { error: insertError } = await supabase.from(UPLOADS_TABLE).insert({
        file_name: selectedFile.name,
        file_path: storagePath,
        file_size: selectedFile.size,
        mime_type: selectedFile.type || null,
      });

      if (insertError) {
        // Keep storage and DB metadata in sync if insert fails.
        await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
        setError(`Kunde inte spara i databasen: ${insertError.message}`);
        return;
      }

      const uploadInfo: UploadResult = {
        fileName: selectedFile.name,
        path: storagePath,
        uploadedAt: new Date().toLocaleString("sv-SE"),
      };

      setLastUpload(uploadInfo);
      setSelectedFile(null);
      setSuccess("Bilden laddades upp och sparades i databasen.");
      await loadUploads();
    } catch {
      setError("Ett oväntat fel uppstod under uppladdning.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="w-full max-w-4xl rounded-xl border border-[#d8d2c8] bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#3d3a36]">Uppladdningar</h1>
          </div>
          <button
            type="button"
            onClick={() => setIsUploaderOpen((prev) => !prev)}
            className="shrink-0 rounded-md border border-[#d8d2c8] bg-[#f7f4ef] px-3 py-2 text-sm font-semibold text-[#4d463f] transition hover:bg-[#eee8df]"
          >
            {isUploaderOpen ? "Stäng" : "Lägg till"}
          </button>
        </div>

        {isUploaderOpen ? (
          <form
            onSubmit={handleUpload}
            className="mt-4 rounded-md border border-[#d8d2c8] bg-[#faf8f4] p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="image-file"
                className="inline-flex cursor-pointer items-center rounded-md bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f]"
              >
                Välj bild
              </label>
              <p className="text-sm text-[#6a6258]">
                {selectedFile ? selectedFile.name : "Ingen fil vald"}
              </p>
              <button
                type="submit"
                disabled={isUploading}
                className="ml-auto rounded-md bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploading ? "Laddar upp..." : "Ladda upp"}
              </button>
            </div>
            <input
              id="image-file"
              type="file"
              accept="image/*"
              onChange={(event) =>
                setSelectedFile(event.target.files?.[0] ?? null)
              }
              className="sr-only"
            />
          </form>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
          </p>
        ) : null}

        {lastUpload ? (
          <div className="mt-6 rounded-md border border-[#d8d2c8] bg-[#f7f4ef] p-4">
            <h2 className="text-sm font-semibold text-[#4d463f]">
              Senaste uppladdning
            </h2>
            <p className="mt-2 text-sm text-[#6a6258]">
              Fil: <span className="font-medium text-[#3d3a36]">{lastUpload.fileName}</span>
            </p>
            <p className="mt-1 text-sm text-[#6a6258]">
              Sökväg: <span className="font-medium text-[#3d3a36]">{lastUpload.path}</span>
            </p>
            <p className="mt-1 text-sm text-[#6a6258]">
              Tid: <span className="font-medium text-[#3d3a36]">{lastUpload.uploadedAt}</span>
            </p>
          </div>
        ) : null}

        <div className="mt-8">
          {isLoadingUploads ? (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-md border border-[#d8d2c8] bg-[#f7f4ef] px-4 py-6 text-[#6a6258]">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <p className="text-sm font-medium">Hämtar uppladdningar...</p>
            </div>
          ) : null}

          {loadError ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {loadError}
            </p>
          ) : null}

          {!isLoadingUploads && !loadError && uploads.length === 0 ? (
            <p className="mt-3 text-sm text-[#6a6258]">
              Inga uppladdningar finns ännu.
            </p>
          ) : null}

          {!isLoadingUploads && !loadError && uploads.length > 0 ? (
            <div className="mt-4 space-y-4">
              {uploads.map((upload) => (
                <article
                  key={upload.id}
                  className="overflow-hidden rounded-md border border-[#d8d2c8] bg-white"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
                    <p className="truncate text-sm font-semibold text-[#4d463f]">
                      {upload.file_name}
                    </p>
                    <p className="shrink-0 text-xs font-medium text-[#7b746a]">
                      {new Date(upload.created_at).toLocaleString("sv-SE")}
                    </p>
                  </div>

                  <div className="flex items-center justify-center bg-[#f0ece6] p-4">
                    {upload.preview_url ? (
                      <Image
                        src={upload.preview_url}
                        alt={upload.file_name}
                        width={1200}
                        height={900}
                        className="max-h-[420px] w-auto max-w-full rounded border border-[#d8d2c8] bg-white object-contain"
                      />
                    ) : (
                      <div className="flex h-52 w-full items-center justify-center rounded border border-[#d8d2c8] bg-[#f7f4ef] text-sm text-[#7b746a]">
                        Ingen bildförhandsvisning
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

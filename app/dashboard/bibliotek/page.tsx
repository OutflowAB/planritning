"use client";

import Image from "next/image";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const GENERATED_PREFIX = "generated/";

type GeneratedImageRow = {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string | null;
  created_at: string;
  preview_url?: string | null;
};

export default function BibliotekPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [images, setImages] = useState<GeneratedImageRow[]>([]);

  async function loadLibrary() {
    setLoadError("");
    setIsLoading(true);

    const { data, error: queryError } = await supabase
      .from(UPLOADS_TABLE)
      .select("id, file_name, file_path, file_size, mime_type, created_at")
      .like("file_path", `${GENERATED_PREFIX}%`)
      .order("created_at", { ascending: false });

    if (queryError) {
      setLoadError(`Kunde inte hämta biblioteket: ${queryError.message}`);
      setIsLoading(false);
      return;
    }

    const rows = (data as GeneratedImageRow[]) ?? [];
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

    setImages(rowsWithPreview);
    setIsLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLibrary();
    }, 0);

    function handleLibraryUpdated() {
      void loadLibrary();
    }

    window.addEventListener("library-updated", handleLibraryUpdated);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("library-updated", handleLibraryUpdated);
    };
  }, []);

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="w-full max-w-5xl rounded-xl border border-[#d8d2c8] bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-[#3d3a36]">Bibliotek</h1>
        </div>

        {isLoading ? (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-md border border-[#d8d2c8] bg-[#f7f4ef] px-4 py-6 text-[#6a6258]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <p className="text-sm font-medium">Hämtar genererade bilder...</p>
          </div>
        ) : null}

        {loadError ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        ) : null}

        {!isLoading && !loadError && images.length === 0 ? (
          <p className="mt-6 text-sm text-[#6a6258]">
            Inga genererade bilder finns ännu. Konvertera en planritning så dyker den upp här.
          </p>
        ) : null}

        {!isLoading && !loadError && images.length > 0 ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {images.map((image) => (
              <article
                key={image.id}
                className="overflow-hidden rounded-md border border-[#d8d2c8] bg-white"
              >
                <div className="flex items-center justify-between gap-3 border-b border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
                  <p className="truncate text-sm font-semibold text-[#4d463f]">
                    {image.file_name}
                  </p>
                  <p className="shrink-0 text-xs font-medium text-[#7b746a]">
                    {new Date(image.created_at).toLocaleString("sv-SE")}
                  </p>
                </div>

                <div className="flex items-center justify-center bg-[#f0ece6] p-4">
                  {image.preview_url ? (
                    <Image
                      src={image.preview_url}
                      alt={image.file_name}
                      width={1200}
                      height={900}
                      className="max-h-[320px] w-auto max-w-full rounded border border-[#d8d2c8] bg-white object-contain"
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
    </section>
  );
}

"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { imageDisplayName } from "@/lib/image-naming";
import { ThumbnailImage } from "@/components/ui/thumbnail-image";
import { resolvePreviewUrls } from "@/lib/image-preview-cache";

const BUCKET_NAME = "planritningar";
const UPLOADS_TABLE = "uploaded_images";
const UPLOADS_PREFIX = "uploads/";
/** Shared with the uploads page, so a preview signed there is reused here and vice versa. */
const PREVIEW_CACHE_KEY = "upload-preview-cache-v1";

type UploadRow = {
  id: number;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  created_at: string;
  preview_url: string | null;
};

export function RecentUploadsStrip() {
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);

      const { data, error: queryError } = await supabase
        .from(UPLOADS_TABLE)
        .select("id, file_name, file_path, mime_type, created_at")
        .like("file_path", `${UPLOADS_PREFIX}%`)
        .order("created_at", { ascending: false })
        .limit(2);

      if (cancelled) {
        return;
      }

      if (queryError) {
        setUploads([]);
        setIsLoading(false);
        return;
      }

      const rows = (data ?? []) as Omit<UploadRow, "preview_url">[];
      const imagePaths = rows
        .filter((row) => row.mime_type?.startsWith("image/"))
        .map((row) => row.file_path);

      const previewByPath =
        imagePaths.length > 0
          ? await resolvePreviewUrls(supabase, BUCKET_NAME, imagePaths, PREVIEW_CACHE_KEY)
          : new Map<string, string>();

      if (cancelled) {
        return;
      }

      setUploads(
        rows.map((row) => ({
          ...row,
          preview_url: previewByPath.get(row.file_path) ?? null,
        })),
      );
      setIsLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center gap-2 rounded-sm border border-slate-300 bg-slate-50 px-4 py-5 text-slate-600"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium">Hämtar senaste uppladdningar…</p>
      </div>
    );
  }

  if (uploads.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      <h2 className="mb-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        Senaste uppladdningar
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {uploads.map((upload) => (
          <li key={upload.id}>
            <Link
              href={`/uppladdningar?previewImageId=${upload.id}`}
              className="group flex flex-col overflow-hidden rounded-sm border border-slate-300 bg-white text-left shadow-sm transition hover:border-slate-400 hover:shadow-md"
            >
              <div className="bg-slate-100 p-3">
                <ThumbnailImage
                  src={upload.preview_url}
                  alt={imageDisplayName(upload.id)}
                  heightClassName="h-[160px]"
                  sizes="(max-width: 640px) 90vw, 320px"
                  priority
                  emptyLabel="Ingen förhandsvisning"
                  frameClassName="bg-white"
                />
              </div>
              <div className="border-t border-slate-200 px-3 py-2.5">
                <p className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">
                  {imageDisplayName(upload.id)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {new Date(upload.created_at).toLocaleString("sv-SE")}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

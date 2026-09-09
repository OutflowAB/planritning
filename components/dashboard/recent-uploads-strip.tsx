"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";

import { ThumbnailImage } from "@/components/ui/thumbnail-image";
import { apiJson } from "@/lib/api-client";
import { imageDisplayName } from "@/lib/image-naming";
import { imageUrl } from "@/lib/image-url";
import { useCachedList } from "@/lib/use-cached-list";

const RECENT_UPLOADS_CACHE_KEY = "recent-uploads-v2";
const RECENT_UPLOADS_LIMIT = 2;

type UploadRow = {
  id: number;
  created_at: string;
  mime_type: string | null;
  version: string | null;
};

async function fetchRecentUploads(signal: AbortSignal): Promise<UploadRow[]> {
  const { items } = await apiJson<{ items: UploadRow[] }>(
    `/api/images?kind=uploads&limit=${RECENT_UPLOADS_LIMIT}`,
    { signal },
  );
  return items.filter((item) => item.mime_type?.startsWith("image/"));
}

export function RecentUploadsStrip() {
  const { items, isLoading, error } = useCachedList(
    RECENT_UPLOADS_CACHE_KEY,
    fetchRecentUploads,
    "Kunde inte hämta senaste uppladdningar.",
  );

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center gap-2 rounded-sm border border-slate-300 bg-slate-50 px-4 py-5 text-slate-600"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium">Hämtar senaste uppladdningar…</p>
      </div>
    );
  }

  if (error || items.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      <h2 className="mb-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        Senaste uppladdningar
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((upload) => (
          <li key={upload.id}>
            <Link
              href={`/uppladdningar?previewImageId=${upload.id}`}
              className="group flex flex-col overflow-hidden rounded-sm border border-slate-300 bg-white text-left shadow-sm transition hover:border-slate-400 hover:shadow-md"
            >
              <div className="bg-slate-100 p-3">
                <ThumbnailImage
                  src={imageUrl(upload.id, "thumb", upload.version)}
                  alt={imageDisplayName(upload.id)}
                  heightClassName="h-[160px]"
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

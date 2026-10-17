"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, Wand2 } from "lucide-react";

import { ThumbnailImage } from "@/components/ui/thumbnail-image";
import { useToast } from "@/components/ui/toast-provider";
import { apiJson } from "@/lib/api-client";
import { LIBRARY_UPDATED_EVENT, subscribeToAppEvent } from "@/lib/app-events";
import { converterHrefForUpload, useHasUnfinishedConverterSession } from "@/lib/converter-transfer";
import { imageDisplayName } from "@/lib/image-naming";
import { imageUrl } from "@/lib/image-url";
import { useCachedList } from "@/lib/use-cached-list";

const UPLOAD_PICKER_CACHE_KEY = "upload-picker-v1";
const UPLOAD_PICKER_LIMIT = 24;

type UploadRow = {
  id: number;
  created_at: string;
  file_path: string;
  mime_type: string | null;
  version: string | null;
  purged_at: string | null;
};

async function fetchUploads(signal: AbortSignal): Promise<UploadRow[]> {
  const { items } = await apiJson<{ items: UploadRow[] }>(`/api/images?kind=uploads&limit=${UPLOAD_PICKER_LIMIT}`, {
    signal,
  });
  // Originals removed after 90 days cannot be redrawn.
  return items.filter((item) => item.mime_type?.startsWith("image/") && !item.purged_at);
}

/** The realtor's uploaded originals, one click from the converter. */
export function UploadPicker() {
  const router = useRouter();
  const { showToast } = useToast();
  const isConverting = useHasUnfinishedConverterSession();
  const { items, isLoading, error, reload } = useCachedList(UPLOAD_PICKER_CACHE_KEY, fetchUploads, "Kunde inte hämta uppladdningarna.");
  // New uploads (made on Uppladdningar or dropped on the converter) appear without a reload.
  useEffect(() => subscribeToAppEvent(LIBRARY_UPDATED_EVENT, reload), [reload]);

  function convert(upload: UploadRow) {
    if (isConverting) {
      showToast("Slutför den påbörjade konverteringen först.", "error");
      return;
    }
    router.push(
      converterHrefForUpload({ ...upload, full_url: imageUrl(upload.id, "full", upload.version) }),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="w-full rounded-none border border-[#d8d2c8] bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-[#3d3a36]">Välj en uppladdad planritning</h2>
        <Link href="/uppladdningar" className="text-xs font-semibold text-[#6a6258] underline-offset-2 hover:underline">
          Ladda upp fler under Uppladdningar
        </Link>
      </div>

      {isLoading ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-[#6a6258]" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Hämtar uppladdningar...
        </p>
      ) : null}
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {!isLoading && !error && items.length === 0 ? (
        <p className="mt-4 text-sm text-[#6a6258]">
          Inga uppladdningar ännu. Ladda upp en planritning under Uppladdningar, eller dra in en bild ovan.
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((upload) => (
            <li key={upload.id}>
              <button
                type="button"
                onClick={() => convert(upload)}
                className="group flex w-full flex-col overflow-hidden border border-[#d8d2c8] bg-white text-left transition hover:border-[#8b7355]"
              >
                <div className="bg-[#f0ece6] p-2">
                  <ThumbnailImage
                    src={imageUrl(upload.id, "thumb", upload.version)}
                    alt={imageDisplayName(upload.id)}
                    heightClassName="h-[120px]"
                    emptyLabel="Ingen förhandsvisning"
                    frameClassName="bg-white"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-[#e8e2d8] px-2.5 py-2">
                  <span className="truncate text-xs font-medium text-[#3d3a36]">{imageDisplayName(upload.id)}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6a6258] group-hover:text-[#3d3a36]">
                    <Wand2 size={12} aria-hidden="true" />
                    Konvertera
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

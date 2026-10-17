"use client";

import { useSyncExternalStore } from "react";

import { resolveImageDownloadFileName } from "@/lib/image-naming";
import {
  CONVERTER_TRANSFER_KEY,
  hasUnfinishedConverterSession,
  subscribeUnfinishedConverterSession,
} from "@/lib/startsida-converter-session";

export const CONVERTER_PATH = "/konverterare";

type TransferableUpload = {
  id: number;
  full_url: string | null;
  mime_type: string | null;
  file_path: string;
};

/**
 * The address that opens an uploaded original in the converter. The image itself is handed
 * over through sessionStorage, so the converter can show it at once without fetching it again.
 */
export function converterHrefForUpload(upload: TransferableUpload) {
  if (upload.full_url) {
    window.sessionStorage.setItem(
      CONVERTER_TRANSFER_KEY,
      JSON.stringify({
        previewUrl: upload.full_url,
        fileName: resolveImageDownloadFileName(upload.id, { mimeType: upload.mime_type, filePath: upload.file_path }),
        uploadId: upload.id,
      }),
    );
  }
  return `${CONVERTER_PATH}?${new URLSearchParams({ fromUpload: String(upload.id) }).toString()}`;
}

/** True while a conversion is under way, so another upload is not swapped in by accident. */
export function useHasUnfinishedConverterSession() {
  return useSyncExternalStore(subscribeUnfinishedConverterSession, () => hasUnfinishedConverterSession(), () => false);
}

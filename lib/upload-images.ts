"use client";

import { apiFetch, describeError } from "@/lib/api-client";
import { prepareImageUpload } from "@/lib/prepare-upload";
import { runLimited } from "@/lib/run-limited";
import type { UploadedImageRow } from "@/lib/supabase-server";

export type UploadedItem = UploadedImageRow & { version: string | null };

export type UploadOutcome =
  | { file: File; ok: true; item: UploadedItem }
  | { file: File; ok: false; message: string };

const UPLOAD_CONCURRENCY = 3;
const ACCEPTED = /^image\/(png|jpe?g|webp)$/i;

/** True for the picture types the app takes; everything else is skipped with a message. */
export function isAcceptedImage(file: File) {
  return ACCEPTED.test(file.type);
}

/**
 * Uploads several images, three at a time. Each file is shrunk to fit the host's limit first
 * and succeeds or fails on its own; `onProgress` hears about every finished file.
 */
export async function uploadImages(
  files: readonly File[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadOutcome[]> {
  let done = 0;
  const settled = await runLimited(files, UPLOAD_CONCURRENCY, async (file): Promise<UploadOutcome> => {
    try {
      if (!isAcceptedImage(file)) {
        return { file, ok: false, message: "Måste vara PNG, JPG eller WEBP." };
      }
      const payload = new FormData();
      payload.append("file", await prepareImageUpload(file));
      const response = await apiFetch("/api/upload", { method: "POST", body: payload });
      const { item } = (await response.json()) as { item: UploadedItem };
      return { file, ok: true, item };
    } catch (error) {
      return { file, ok: false, message: describeError(error, "Kunde inte ladda upp filen.") ?? "Kunde inte ladda upp filen." };
    } finally {
      done += 1;
      onProgress?.(done, files.length);
    }
  });

  return settled.map((result, index) =>
    result.status === "fulfilled" ? result.value : { file: files[index], ok: false, message: "Kunde inte ladda upp filen." },
  );
}

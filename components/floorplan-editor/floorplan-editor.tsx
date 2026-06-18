"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";

import { EditorToolbar } from "@/components/floorplan-editor/editor-toolbar";
import { EditorTopBar } from "@/components/floorplan-editor/editor-top-bar";
import { useFloorplanEditor } from "@/components/floorplan-editor/hooks/use-floorplan-editor";

const EditorCanvas = dynamic(
  () => import("@/components/floorplan-editor/editor-canvas").then((module) => module.EditorCanvas),
  {
    ssr: false,
    loading: () => <EditorCanvasLoading />,
  },
);

type ApprovedImage = {
  id: number;
  file_name: string;
  file_path: string;
  preview_url: string;
  is_saved: boolean;
};

type FloorplanEditorProps = {
  approvedImage: ApprovedImage;
  onSaveToLibrary: () => Promise<void>;
  onLeaveWithoutSaving: () => Promise<void>;
  isPublishing?: boolean;
  isLeaving?: boolean;
  imageLoadError?: string;
};

function EditorCanvasLoading() {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center bg-[#ebe7e1] text-sm text-[#6a6258]"
      aria-busy="true"
      aria-live="polite"
    >
      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
      Bilden laddas in...
    </div>
  );
}

export function FloorplanEditor({
  approvedImage,
  onSaveToLibrary,
  onLeaveWithoutSaving,
  isPublishing = false,
  isLeaving = false,
  imageLoadError = "",
}: FloorplanEditorProps) {
  const [errorMessage, setErrorMessage] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const onError = useCallback((message: string) => {
    setErrorMessage(message);
  }, []);

  const controller = useFloorplanEditor({
    approvedImage,
    onError,
  });

  async function handleSaveToLibrary() {
    setErrorMessage("");

    try {
      const saved = await controller.saveDocument();
      if (!saved) {
        return;
      }

      await controller.publishFlattenedImage();
      await onSaveToLibrary();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Kunde inte spara bilden just nu.",
      );
    }
  }

  async function handleLeave() {
    const saved = await controller.saveDocument();
    if (saved) {
      await onLeaveWithoutSaving();
    }
  }

  function handleResetToOriginalClick() {
    if (!controller.canResetToOriginal) {
      return;
    }

    setShowResetConfirm(true);
  }

  function confirmResetToOriginal() {
    controller.resetToOriginal();
    setShowResetConfirm(false);
  }

  const isEditorLoading = controller.isLoading;
  const blockingCanvasError = imageLoadError;

  return (
    <section className="flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] w-full flex-col overflow-hidden bg-[#f5f3f0]">
      <EditorTopBar
        controller={controller}
        showPublish={!approvedImage.is_saved}
        isPublishing={isPublishing}
        isLeaving={isLeaving}
        isLoading={isEditorLoading}
        onSaveAndPublish={handleSaveToLibrary}
        onLeave={() => void handleLeave()}
        onResetToOriginal={handleResetToOriginalClick}
      />

      {showResetConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={() => setShowResetConfirm(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-none border border-[#d8d2c8] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
            role="alertdialog"
            aria-labelledby="reset-original-title"
            aria-describedby="reset-original-description"
          >
            <div className="border-b border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
              <h2 id="reset-original-title" className="text-sm font-semibold text-[#4d463f]">
                Återställ till original?
              </h2>
            </div>
            <div className="px-4 py-4">
              <p id="reset-original-description" className="text-sm text-[#6a6258]">
                Alla ändringar tas bort och planritningen återgår till originalbilden.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="rounded-none border border-[#d8d2c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={confirmResetToOriginal}
                className="rounded-none border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
              >
                Återställ original
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {errorMessage && !isEditorLoading ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{errorMessage}</p>
      ) : null}

      {blockingCanvasError && !isEditorLoading ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{blockingCanvasError}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <EditorToolbar controller={controller} isLoading={isEditorLoading} />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isEditorLoading ? (
            <EditorCanvasLoading />
          ) : blockingCanvasError ? (
            <div className="flex min-h-0 flex-1 items-center justify-center bg-[#ebe7e1] px-6 text-center text-sm text-red-700">
              {blockingCanvasError}
            </div>
          ) : (
            <EditorCanvas controller={controller} />
          )}
        </main>
      </div>
    </section>
  );
}

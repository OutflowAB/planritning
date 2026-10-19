"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiFetch, describeError } from "@/lib/api-client";
import { BLANK_FLOORPLAN_PREFIX } from "@/lib/floorplan/image-url";
import { EditorToolbar, type PlanMeta } from "@/components/floorplan-editor/editor-toolbar";
import { EditorTopBar } from "@/components/floorplan-editor/editor-top-bar";
import { useFloorplanEditor } from "@/components/floorplan-editor/hooks/use-floorplan-editor";

const EditorCanvas = dynamic(
  () => import("@/components/floorplan-editor/editor-canvas").then((module) => module.EditorCanvas),
  {
    ssr: false,
    loading: () => <EditorCanvasLoading />,
  },
);

// three.js is loaded only when the 3D scan is opened.
const ScanMeshViewer = dynamic(
  () => import("@/components/floorplan-editor/scan-mesh-viewer").then((module) => module.ScanMeshViewer),
  { ssr: false },
);

type ApprovedImage = {
  id: number;
  file_name: string;
  file_path: string;
  preview_url: string;
  is_saved: boolean;
  address?: string | null;
  floor_label?: string | null;
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
      className="flex min-h-0 flex-1 items-center justify-center bg-stone-200 text-sm text-stone-600"
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
  // The plan whose 3D mesh was found, so a plan switched to does not show the last one's button.
  const [scanMeshFor, setScanMeshFor] = useState<number | null>(null);
  const hasScanMesh = scanMeshFor === approvedImage.id;
  const [showScanMesh, setShowScanMesh] = useState(false);

  // Scanned and blank plans carry an address and floor, printed on the finished plan; the
  // address is the image's name, as everywhere else in the app. AI-redrawn sheets have neither.
  const hasPlanMeta = approvedImage.file_path.startsWith(BLANK_FLOORPLAN_PREFIX);
  // The editor can mount with a placeholder while the plan loads; its address arrives later.
  const metaFromPlan: PlanMeta = { address: approvedImage.address ?? "", floorLabel: approvedImage.floor_label ?? "" };
  const metaKey = `${approvedImage.id}|${metaFromPlan.address}|${metaFromPlan.floorLabel}`;
  const [planMeta, setPlanMeta] = useState(metaFromPlan);
  const [savedMeta, setSavedMeta] = useState(metaFromPlan);
  const [loadedMetaKey, setLoadedMetaKey] = useState(metaKey);
  if (loadedMetaKey !== metaKey) {
    setLoadedMetaKey(metaKey);
    setPlanMeta(metaFromPlan);
    setSavedMeta(metaFromPlan);
  }

  /** Saves the address and floor if they changed. */
  const savePlanMeta = useCallback(async () => {
    if (!hasPlanMeta || (savedMeta.address === planMeta.address && savedMeta.floorLabel === planMeta.floorLabel)) {
      return;
    }
    try {
      await apiFetch("/api/floorplan-meta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: approvedImage.id, ...planMeta }),
      });
      setSavedMeta(planMeta);
    } catch (error) {
      setErrorMessage(describeError(error, "Kunde inte spara adressen.") ?? "");
    }
  }, [approvedImage.id, hasPlanMeta, planMeta, savedMeta]);

  // Saved a moment after typing stops: clicking the drawing does not take focus from a field.
  useEffect(() => {
    const timer = window.setTimeout(() => void savePlanMeta(), 800);
    return () => window.clearTimeout(timer);
  }, [savePlanMeta]);

  // Only scans have a 3D mesh; the button shows once one is found.
  useEffect(() => {
    if (!approvedImage.file_path.startsWith(BLANK_FLOORPLAN_PREFIX)) return;
    let active = true;
    fetch(`/api/scan-mesh?imageId=${approvedImage.id}`, { cache: "no-store" })
      .then((response) => {
        if (active && response.ok) setScanMeshFor(approvedImage.id);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [approvedImage.id, approvedImage.file_path]);

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

      await savePlanMeta();
      await controller.publishFlattenedImage(
        hasPlanMeta ? { address: planMeta.address, floorLabel: planMeta.floorLabel } : undefined,
      );
      await onSaveToLibrary();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Kunde inte spara bilden just nu.",
      );
    }
  }

  async function handleLeave() {
    await savePlanMeta();
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
    <section className="flex h-[calc(100dvh-3rem)] max-h-[calc(100dvh-3rem)] w-full flex-col overflow-hidden bg-canvas">
      <EditorTopBar
        controller={controller}
        showPublish={!approvedImage.is_saved}
        isPublishing={isPublishing}
        isLeaving={isLeaving}
        isLoading={isEditorLoading}
        onSaveAndPublish={handleSaveToLibrary}
        onLeave={() => void handleLeave()}
        onResetToOriginal={handleResetToOriginalClick}
        onShowScanMesh={hasScanMesh ? () => setShowScanMesh(true) : undefined}
      />

      {showScanMesh ? <ScanMeshViewer imageId={approvedImage.id} onClose={() => setShowScanMesh(false)} /> : null}

      {showResetConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={() => setShowResetConfirm(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg border border-stone-200 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
            role="alertdialog"
            aria-labelledby="reset-original-title"
            aria-describedby="reset-original-description"
          >
            <div className="border-b border-stone-100 bg-stone-50 px-4 py-3">
              <h2 id="reset-original-title" className="text-sm font-semibold text-stone-800">
                Återställ till original?
              </h2>
            </div>
            <div className="px-4 py-4">
              <p id="reset-original-description" className="text-sm text-stone-600">
                Alla ändringar tas bort och planritningen återgår till originalbilden.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-stone-100 bg-stone-50 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={confirmResetToOriginal}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
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
        <EditorToolbar
          controller={controller}
          isLoading={isEditorLoading}
          planMeta={hasPlanMeta ? planMeta : undefined}
          onPlanMetaChange={setPlanMeta}
          onPlanMetaCommit={() => void savePlanMeta()}
        />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isEditorLoading ? (
            <EditorCanvasLoading />
          ) : blockingCanvasError ? (
            <div className="flex min-h-0 flex-1 items-center justify-center bg-stone-200 px-6 text-center text-sm text-red-700">
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

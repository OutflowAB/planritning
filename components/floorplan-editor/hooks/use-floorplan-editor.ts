"use client";

import {
  createDefaultDimension,
  createDefaultDoor,
  createDefaultFurniture,
  createDefaultRoomLabel,
  createDefaultStair,
  createDefaultSymbol,
  createDefaultWindow,
  createEmptyDocument,
  inferCanvasSizeFromImageUrl,
  touchDocument,
} from "@/lib/floorplan/document-factory";
import {
  applyPropertiesToFabricObject,
  applyCanvasLayerOrder,
  attachExtendedData,
  attachEraserStrokeMetadata,
  createEraserStrokeFromPath,
  createFabricObjectFromFloorplan,
  duplicateFabricObject,
  floorplanObjectFromFabric,
  getFloorplanMeta,
  hasFloorplanBackground,
  isCanvasOperational,
  renderDocumentToCanvas,
  sortFloorplanObjectsByLayer,
  syncCanvasToDocument,
} from "@/lib/floorplan/fabric/sync";
import {
  canRedo,
  canUndo,
  createHistoryState,
  pushHistory,
  redoHistory,
  undoHistory,
  type FloorplanHistoryState,
} from "@/lib/floorplan/history";
import { getFurnitureById, getSymbolById } from "@/lib/floorplan/symbol-library";
import { buildFloorplanImageUrl } from "@/lib/floorplan/image-url";
import { renderFloorplanDocumentToPngDataUrl } from "@/lib/floorplan/export-library";
import { publishFloorplanImage } from "@/lib/floorplan/publish-floorplan";
import { imageDownloadBaseName } from "@/lib/image-naming";
import { snapFloorplanObjectPosition } from "@/lib/floorplan/fabric/object-snapping";
import type { EditorTool, FloorplanDocument, FloorplanObject } from "@/lib/floorplan/types";
import { createObjectId } from "@/lib/floorplan/types";
import type { Canvas, FabricObject } from "fabric";
import { Path } from "fabric";
import { useCallback, useEffect, useRef, useState } from "react";

type ApprovedImage = {
  id: number;
  file_name: string;
  file_path: string;
  preview_url: string;
};

type UseFloorplanEditorOptions = {
  approvedImage: ApprovedImage;
  onError: (message: string) => void;
};

export const FLOORPLAN_MIN_ZOOM = 0.5;
export const FLOORPLAN_MAX_ZOOM = 4;
export const FLOORPLAN_ZOOM_STEP = 1.15;
export const FLOORPLAN_NUDGE_STEP = 1;
export const FLOORPLAN_NUDGE_STEP_LARGE = 10;
export const FLOORPLAN_AUTO_SAVE_DEBOUNCE_MS = 800;

function clampZoomLevel(value: number) {
  return Math.min(FLOORPLAN_MAX_ZOOM, Math.max(FLOORPLAN_MIN_ZOOM, value));
}

function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function useFloorplanEditor({ approvedImage, onError }: UseFloorplanEditorOptions) {
  const canvasRef = useRef<Canvas | null>(null);
  const [history, setHistory] = useState<FloorplanHistoryState | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>("select");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string>("wc");
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string>("soffa");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [canvasReadyVersion, setCanvasReadyVersion] = useState(0);
  /** Ökas vid undo/redo så canvas synkas från dokument utan att varje redigering triggar omritning. */
  const [renderRevision, setRenderRevision] = useState(0);
  const [zoomLevel, setZoomLevelState] = useState(1);
  const placementStartRef = useRef<{ x: number; y: number } | null>(null);
  const documentRef = useRef<FloorplanDocument | null>(null);
  const syncFromCanvasRef = useRef<() => void>(() => {});
  const clipboardRef = useRef<FloorplanObject | null>(null);
  const pasteCountRef = useRef(0);
  const isDirtyRef = useRef(false);
  const skipPersistRef = useRef(false);
  const saveDocumentRef = useRef<() => Promise<boolean>>(async () => false);

  useEffect(() => {
    placementStartRef.current = null;
  }, [activeTool]);

  const document = history?.present ?? null;
  documentRef.current = document;
  isDirtyRef.current = isDirty;
  const selectedObject =
    document?.objects.find((object) => object.id === selectedObjectId) ?? null;

  const commitDocument = useCallback((nextDocument: FloorplanDocument, markDirty = true) => {
    setHistory((previous) => {
      if (!previous) {
        return createHistoryState(nextDocument);
      }
      return pushHistory(previous, nextDocument);
    });
    if (markDirty) {
      setIsDirty(true);
    }
  }, []);

  const syncFromCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const currentDocument = documentRef.current;
    if (!canvas || !currentDocument) {
      return;
    }
    const nextDocument = syncCanvasToDocument(canvas, currentDocument);
    applyCanvasLayerOrder(canvas);
    canvas.requestRenderAll();
    documentRef.current = nextDocument;
    commitDocument(nextDocument);
  }, [commitDocument]);

  syncFromCanvasRef.current = syncFromCanvas;

  const renderCanvas = useCallback(async () => {
    const canvas = canvasRef.current;
    const currentDocument = documentRef.current;
    if (!isCanvasOperational(canvas) || !currentDocument) {
      return;
    }

    const imageUrl = buildFloorplanImageUrl(
      currentDocument.meta.imageId,
      currentDocument.meta.imagePath,
    );

    try {
      await renderDocumentToCanvas(canvas, currentDocument, imageUrl);
    } catch (error) {
      if (!isCanvasOperational(canvasRef.current)) {
        return;
      }
      onError(error instanceof Error ? error.message : "Kunde inte visa planritningsbilden.");
      throw error;
    }
  }, [onError]);

  const registerCanvas = useCallback(
    (canvas: Canvas | null) => {
      canvasRef.current = canvas;
      if (!canvas) {
        return;
      }

      canvas.on("selection:created", (event) => {
        const target = event.selected?.[0];
        const meta = target ? getFloorplanMeta(target) : null;
        setSelectedObjectId(meta?.floorplanId ?? null);
      });
      canvas.on("selection:updated", (event) => {
        const target = event.selected?.[0];
        const meta = target ? getFloorplanMeta(target) : null;
        setSelectedObjectId(meta?.floorplanId ?? null);
      });
      canvas.on("selection:cleared", () => {
        setSelectedObjectId(null);
      });
      canvas.on("object:modified", () => {
        if (canvas.isDrawingMode) {
          return;
        }
        syncFromCanvasRef.current();
      });

      function handlePathCreated(event: { path: FabricObject }) {
        if (!(event.path instanceof Path)) {
          return;
        }

        const stroke = createEraserStrokeFromPath(event.path);
        attachEraserStrokeMetadata(event.path, stroke);

        const currentDocument = documentRef.current;
        if (!currentDocument) {
          return;
        }

        const nextDocument = touchDocument({
          ...currentDocument,
          objects: sortFloorplanObjectsByLayer([...currentDocument.objects, stroke]),
        });
        documentRef.current = nextDocument;
        commitDocument(nextDocument);
        applyCanvasLayerOrder(canvas);
        canvas.requestRenderAll();
      }

      canvas.on("path:created", handlePathCreated);

      setCanvasReadyVersion((version) => version + 1);
    },
    [],
  );

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          imageId: String(approvedImage.id),
          imagePath: approvedImage.file_path,
        });
        const response = await fetch(`/api/floorplan-document?${params.toString()}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          document?: FloorplanDocument;
          message?: string;
        };

        let nextDocument = data.document ?? null;
        if (!response.ok && response.status !== 404) {
          throw new Error(data.message ?? "Kunde inte ladda planritningen.");
        }

        if (!nextDocument) {
          const canvasSize = await inferCanvasSizeFromImageUrl(
            buildFloorplanImageUrl(approvedImage.id, approvedImage.file_path),
          );
          nextDocument = createEmptyDocument({
            imageId: approvedImage.id,
            imagePath: approvedImage.file_path,
            fileName: imageDownloadBaseName(approvedImage.id),
            canvasWidth: canvasSize.width,
            canvasHeight: canvasSize.height,
          });
        }

        if (!active) {
          return;
        }

        setHistory(createHistoryState(nextDocument));
        setIsDirty(false);
        setIsLoading(false);
      } catch (error) {
        if (!active) {
          return;
        }
        onError(error instanceof Error ? error.message : "Kunde inte ladda planritningen.");
        setIsLoading(false);
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [approvedImage, onError]);

  const setZoomLevel = useCallback((value: number | ((previous: number) => number)) => {
    setZoomLevelState((previous) => {
      const next = typeof value === "function" ? value(previous) : value;
      return clampZoomLevel(next);
    });
  }, []);

  const zoomIn = useCallback(() => {
    setZoomLevel((previous) => previous * FLOORPLAN_ZOOM_STEP);
  }, [setZoomLevel]);

  const zoomOut = useCallback(() => {
    setZoomLevel((previous) => previous / FLOORPLAN_ZOOM_STEP);
  }, [setZoomLevel]);

  const applyDisplayScale = useCallback(
    (size: { width: number; height: number }) => {
      const canvas = canvasRef.current;
      if (!isCanvasOperational(canvas) || size.width <= 0 || size.height <= 0) {
        return;
      }

      canvas.setDimensions(
        {
          width: size.width,
          height: size.height,
        },
        { cssOnly: true },
      );
      canvas.requestRenderAll();
    },
    [],
  );

  const addObject = useCallback(
    (object: FloorplanObject) => {
      if (!document) {
        return;
      }
      const canvas = canvasRef.current;
      const placedObject =
        canvas && hasFloorplanBackground(canvas)
          ? snapFloorplanObjectPosition(canvas, object)
          : object;

      const nextDocument = touchDocument({
        ...document,
        objects: [...document.objects, placedObject],
      });
      documentRef.current = nextDocument;
      commitDocument(nextDocument);

      if (!canvas) {
        return;
      }

      if (!hasFloorplanBackground(canvas)) {
        setRenderRevision((version) => version + 1);
        setSelectedObjectId(placedObject.id);
        return;
      }

      const fabricObject = createFabricObjectFromFloorplan(placedObject);
      attachExtendedData(fabricObject, placedObject);
      canvas.add(fabricObject);
      applyCanvasLayerOrder(canvas);
      canvas.setActiveObject(fabricObject);
      canvas.requestRenderAll();
      setSelectedObjectId(placedObject.id);
    },
    [commitDocument, document],
  );

  const addObjectAtCenter = useCallback(
    (factory: (x: number, y: number) => FloorplanObject) => {
      if (!document) {
        return;
      }
      const x = document.canvas.width / 2 - 40;
      const y = document.canvas.height / 2 - 40;
      addObject(factory(x, y));
    },
    [addObject, document],
  );

  const handleCanvasPointer = useCallback(
    (point: { x: number; y: number }) => {
      if (!document) {
        return;
      }

      if (activeTool === "eraser" || activeTool === "select") {
        return;
      }

      if (activeTool === "dimension") {
        if (!placementStartRef.current) {
          placementStartRef.current = point;
          return;
        }

        const start = placementStartRef.current;
        placementStartRef.current = null;

        addObject({
          ...createDefaultDimension(start.x, start.y),
          x2: point.x,
          y2: point.y,
        } as FloorplanObject);
        setActiveTool("select");
        return;
      }

      switch (activeTool) {
        case "roomLabel":
          addObject(createDefaultRoomLabel(point.x, point.y));
          break;
        case "door":
          addObject(createDefaultDoor(point.x, point.y));
          break;
        case "window":
          addObject(createDefaultWindow(point.x, point.y));
          break;
        case "stair":
          addObject(createDefaultStair(point.x, point.y));
          break;
        case "symbol": {
          const symbol = getSymbolById(selectedSymbolId);
          addObject(
            createDefaultSymbol(
              point.x,
              point.y,
              selectedSymbolId,
              symbol?.defaultWidth ?? 40,
              symbol?.defaultHeight ?? 40,
            ),
          );
          break;
        }
        case "furniture": {
          const furniture = getFurnitureById(selectedFurnitureId);
          addObject(
            createDefaultFurniture(
              point.x,
              point.y,
              selectedFurnitureId,
              furniture?.defaultWidth ?? 48,
              furniture?.defaultHeight ?? 48,
            ),
          );
          break;
        }
        default:
          break;
      }

      setActiveTool("select");
    },
    [activeTool, addObject, document, selectedFurnitureId, selectedSymbolId],
  );

  const deleteSelected = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !document || !selectedObjectId) {
      return;
    }

    const active = canvas.getActiveObject();
    if (active) {
      canvas.remove(active);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    }

    const nextDocument = touchDocument({
      ...document,
      objects: document.objects.filter((object) => object.id !== selectedObjectId),
    });
    commitDocument(nextDocument);
    setSelectedObjectId(null);
  }, [commitDocument, document, selectedObjectId]);

  const duplicateSelected = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !document) {
      return;
    }

    const active = canvas.getActiveObject();
    if (!active) {
      return;
    }

    const clone = duplicateFabricObject(active);
    if (!clone) {
      return;
    }

    canvas.add(clone);
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
    syncFromCanvas();
  }, [document, syncFromCanvas]);

  const copySelected = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || activeTool !== "select") {
      return;
    }

    const active = canvas.getActiveObject();
    if (!active) {
      return;
    }

    const object = floorplanObjectFromFabric(active);
    if (!object) {
      return;
    }

    clipboardRef.current = structuredClone(object);
    pasteCountRef.current = 0;
  }, [activeTool]);

  const pasteFromClipboard = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard || activeTool !== "select" || !document) {
      return;
    }

    pasteCountRef.current += 1;
    const offset = 16 * pasteCountRef.current;
    const newObject = {
      ...structuredClone(clipboard),
      id: createObjectId(),
      x: clipboard.x + offset,
      y: clipboard.y + offset,
    } as FloorplanObject;

    addObject(newObject);
  }, [activeTool, addObject, document]);

  const updateSelectedObject = useCallback(
    (patch: Partial<FloorplanObject>) => {
      const canvas = canvasRef.current;
      if (!canvas || !document || !selectedObject) {
        return;
      }

      const active = canvas.getActiveObject();
      if (!active) {
        return;
      }

      const nextObject = {
        ...selectedObject,
        ...patch,
        id: selectedObject.id,
        type: selectedObject.type,
      } as FloorplanObject;

      const recreated = applyPropertiesToFabricObject(active, nextObject);
      if (!recreated) {
        return;
      }

      canvas.remove(active);
      canvas.add(recreated);
      canvas.setActiveObject(recreated);
      canvas.requestRenderAll();

      const nextDocument = touchDocument({
        ...document,
        objects: document.objects.map((object) =>
          object.id === selectedObject.id ? nextObject : object,
        ),
      });
      commitDocument(nextDocument);
    },
    [commitDocument, document, selectedObject],
  );

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (!selectedObject || activeTool !== "select") {
        return;
      }

      if (selectedObject.type === "wall" || selectedObject.type === "dimension") {
        updateSelectedObject({
          x: selectedObject.x + dx,
          y: selectedObject.y + dy,
          x2: selectedObject.x2 + dx,
          y2: selectedObject.y2 + dy,
        });
        return;
      }

      updateSelectedObject({
        x: selectedObject.x + dx,
        y: selectedObject.y + dy,
      });
    },
    [activeTool, selectedObject, updateSelectedObject],
  );

  const undo = useCallback(() => {
    setHistory((previous) => {
      if (!previous || !canUndo(previous)) {
        return previous;
      }
      return undoHistory(previous);
    });
    setIsDirty(true);
    setRenderRevision((version) => version + 1);
  }, []);

  const redo = useCallback(() => {
    setHistory((previous) => {
      if (!previous || !canRedo(previous)) {
        return previous;
      }
      return redoHistory(previous);
    });
    setIsDirty(true);
    setRenderRevision((version) => version + 1);
  }, []);

  const resetToOriginal = useCallback(() => {
    const currentDocument = documentRef.current;
    if (!currentDocument) {
      return false;
    }

    const nextDocument = touchDocument(
      createEmptyDocument({
        imageId: currentDocument.meta.imageId,
        imagePath: currentDocument.meta.imagePath,
        fileName: currentDocument.meta.fileName,
        canvasWidth: currentDocument.canvas.width,
        canvasHeight: currentDocument.canvas.height,
      }),
    );

    documentRef.current = nextDocument;
    commitDocument(nextDocument);
    setSelectedObjectId(null);
    setRenderRevision((version) => version + 1);
    return true;
  }, [commitDocument]);

  const canResetToOriginal = Boolean(document && document.objects.length > 0);

  const saveDocument = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !document) {
      return false;
    }

    setIsSaving(true);
    try {
      const latestDocument = syncCanvasToDocument(canvas, document);
      const response = await fetch("/api/floorplan-document", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageId: approvedImage.id,
          imagePath: approvedImage.file_path,
          document: latestDocument,
        }),
      });
      const data = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(data.message ?? "Kunde inte spara planritningen.");
      }

      documentRef.current = latestDocument;
      setIsDirty(false);
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : "Kunde inte spara planritningen.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [approvedImage.file_path, approvedImage.id, document, onError]);

  const publishFlattenedImage = useCallback(async () => {
    const canvas = canvasRef.current;
    const currentDocument = documentRef.current;
    if (!canvas || !currentDocument || currentDocument.objects.length === 0) {
      return true;
    }

    const latestDocument = syncCanvasToDocument(canvas, currentDocument);
    const pngDataUrl = await renderFloorplanDocumentToPngDataUrl(
      latestDocument,
      approvedImage.id,
      approvedImage.file_path,
    );

    await publishFloorplanImage({
      imageId: approvedImage.id,
      imagePath: approvedImage.file_path,
      pngDataUrl,
    });

    skipPersistRef.current = true;
    setIsDirty(false);
    return true;
  }, [approvedImage.file_path, approvedImage.id]);

  const discardDocumentChanges = useCallback(async () => {
    skipPersistRef.current = true;
    setIsDirty(false);

    try {
      const params = new URLSearchParams({
        imageId: String(approvedImage.id),
        imagePath: approvedImage.file_path,
      });
      const response = await fetch(`/api/floorplan-document?${params.toString()}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(data.message ?? "Kunde inte ta bort planritningsdata.");
      }

      return true;
    } catch (error) {
      skipPersistRef.current = false;
      onError(error instanceof Error ? error.message : "Kunde inte ta bort planritningsdata.");
      return false;
    }
  }, [approvedImage.file_path, approvedImage.id, onError]);

  saveDocumentRef.current = saveDocument;

  useEffect(() => {
    if (!isDirty || isLoading || isSaving || !document || skipPersistRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveDocumentRef.current();
    }, FLOORPLAN_AUTO_SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [document, isDirty, isLoading, isSaving]);

  useEffect(() => {
    function flushSaveOnLeave() {
      if (!isDirtyRef.current || skipPersistRef.current) {
        return;
      }

      const canvas = canvasRef.current;
      const currentDocument = documentRef.current;
      if (!canvas || !currentDocument) {
        return;
      }

      const latestDocument = syncCanvasToDocument(canvas, currentDocument);
      fetch("/api/floorplan-document", {
        method: "PUT",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageId: approvedImage.id,
          imagePath: approvedImage.file_path,
          document: latestDocument,
        }),
      }).catch(() => {});
    }

    window.addEventListener("beforeunload", flushSaveOnLeave);
    window.addEventListener("pagehide", flushSaveOnLeave);

    return () => {
      window.removeEventListener("beforeunload", flushSaveOnLeave);
      window.removeEventListener("pagehide", flushSaveOnLeave);
    };
  }, [approvedImage.file_path, approvedImage.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTextInputTarget(event.target)) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (modifier && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (modifier && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }

      if (modifier && key === "c") {
        if (activeTool !== "select" || !selectedObjectId) {
          return;
        }
        event.preventDefault();
        copySelected();
        return;
      }

      if (modifier && key === "v") {
        if (activeTool !== "select" || !clipboardRef.current) {
          return;
        }
        event.preventDefault();
        pasteFromClipboard();
        return;
      }

      if (
        activeTool === "select" &&
        selectedObjectId &&
        (event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight")
      ) {
        event.preventDefault();
        const step = event.shiftKey ? FLOORPLAN_NUDGE_STEP_LARGE : FLOORPLAN_NUDGE_STEP;
        switch (event.key) {
          case "ArrowUp":
            nudgeSelected(0, -step);
            break;
          case "ArrowDown":
            nudgeSelected(0, step);
            break;
          case "ArrowLeft":
            nudgeSelected(-step, 0);
            break;
          case "ArrowRight":
            nudgeSelected(step, 0);
            break;
        }
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (activeTool !== "select" || !selectedObjectId) {
        return;
      }

      event.preventDefault();
      deleteSelected();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTool, copySelected, deleteSelected, nudgeSelected, pasteFromClipboard, redo, selectedObjectId, undo]);

  return {
    canvasRef,
    registerCanvas,
    document,
    canvasReadyVersion,
    renderRevision,
    isLoading,
    isSaving,
    activeTool,
    setActiveTool,
    selectedObject,
    selectedSymbolId,
    setSelectedSymbolId,
    selectedFurnitureId,
    setSelectedFurnitureId,
    handleCanvasPointer,
    addObjectAtCenter,
    deleteSelected,
    duplicateSelected,
    copySelected,
    pasteFromClipboard,
    updateSelectedObject,
    undo,
    redo,
    resetToOriginal,
    canUndo: history ? canUndo(history) : false,
    canRedo: history ? canRedo(history) : false,
    canResetToOriginal,
    saveDocument,
    publishFlattenedImage,
    discardDocumentChanges,
    renderCanvas,
    applyDisplayScale,
    zoomLevel,
    setZoomLevel,
    zoomIn,
    zoomOut,
  };
}

export type FloorplanEditorController = ReturnType<typeof useFloorplanEditor>;

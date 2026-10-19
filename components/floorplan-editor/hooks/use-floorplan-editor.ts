"use client";

import {
  createDefaultDimension,
  createDefaultWall,
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
  drawGuides,
  duplicateFabricObject,
  floorplanObjectFromFabric,
  getFloorplanMeta,
  hasFloorplanBackground,
  isCanvasOperational,
  isStretchedBox,
  moveAttachedObjects,
  redrawStretchedBox,
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
import { ApiError, apiFetch } from "@/lib/api-client";
import { defaultObjectScale, SM_EDITOR } from "@/lib/sm-floorplan-layout";
import { wallCentreLine, wallFromClicks } from "@/lib/floorplan/wall-placement";
import { buildFloorplanImageUrl } from "@/lib/floorplan/image-url";
import { type HouseText, renderFloorplanDocumentToPngDataUrl } from "@/lib/floorplan/export-library";
import { publishFloorplanImage } from "@/lib/floorplan/publish-floorplan";
import { imageDownloadBaseName } from "@/lib/image-naming";
import { canvasPixels, setHandleScale } from "@/lib/floorplan/fabric/canva-controls";
import {
  snapFloorplanObjectPosition,
  snapStretchToWalls,
  snapToWallsAndCounters,
} from "@/lib/floorplan/fabric/object-snapping";
import { formatMeters, lineLengthInMeters } from "@/lib/floorplan/measure";
import { originalDocument } from "@/lib/floorplan/original-document";
import { rotatePlanQuarterTurn } from "@/lib/floorplan/rotate-plan";
import type { EditorTool, FloorplanDocument, FloorplanObject } from "@/lib/floorplan/types";
import { createObjectId } from "@/lib/floorplan/types";
import type { Canvas, FabricObject } from "fabric";
import { Path } from "fabric";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
// How close, on screen, a click must come to a wall for a new wall to join it.
const WALL_SNAP_SCREEN_PIXELS = 12;

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

/** Typical sizes in metres for things drawn by hand on a plan with a scale. */
const REAL_SIZE_M = {
  doorWidth: 0.9,
  windowWidth: 1.2,
  windowDepth: 0.15,
  stairWidth: 1,
  stairLength: 2.5,
  wallThickness: 0.15,
};

export function useFloorplanEditor({ approvedImage, onError }: UseFloorplanEditorOptions) {
  const canvasRef = useRef<Canvas | null>(null);
  const [history, setHistory] = useState<FloorplanHistoryState | null>(null);
  /** The plan as first imported (a LiDAR scan), which "Original" returns to. Null for others. */
  const [sourceDocument, setSourceDocument] = useState<FloorplanDocument | null>(null);
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
  // The blue help lines where the LiDAR mesh saw window; shown unless switched off.
  const [showGuides, setShowGuides] = useState(true);
  const showGuidesRef = useRef(true);
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
  // Refs mirror the latest render for callbacks that must not close over stale values. They
  // are written in a layout effect so the write never happens during render.
  useLayoutEffect(() => {
    documentRef.current = document;
    isDirtyRef.current = isDirty;
  });
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

  useLayoutEffect(() => {
    syncFromCanvasRef.current = syncFromCanvas;
  });

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
      drawGuides(canvas, currentDocument, showGuidesRef.current);
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
      // Registered after the alignment guides, so a wall or counter has the last word.
      canvas.on("object:moving", (event) => {
        snapToWallsAndCounters(canvas, event.target);
      });
      canvas.on("object:scaling", (event) => {
        snapStretchToWalls(canvas, event.target, event.transform);
      });
      canvas.on("object:modified", (event) => {
        if (canvas.isDrawingMode) {
          return;
        }
        const target = event.target;
        // Turned square, a fitting may now stand against a wall.
        if (target && event.action === "rotate") snapToWallsAndCounters(canvas, target);
        if (target && isStretchedBox(target)) {
          // A stretched counter is redrawn at its new size once Fabric has finished the drag:
          // replacing it inside this event would start the event again.
          setTimeout(() => {
            redrawStretchedBox(canvas, target);
            syncFromCanvasRef.current();
          });
          return;
        }
        moveAttachedObjects(canvas, event.target, event.action, event.transform?.original);
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
        const activeCanvas = canvasRef.current;
        if (!activeCanvas) {
          return;
        }
        applyCanvasLayerOrder(activeCanvas);
        activeCanvas.requestRenderAll();
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
        let nextDocument: FloorplanDocument | null = null;
        let nextSource: FloorplanDocument | null = null;
        try {
          const response = await apiFetch(`/api/floorplan-document?${params.toString()}`, {
            cache: "no-store",
          });
          const data = (await response.json()) as {
            document?: FloorplanDocument;
            sourceDocument?: FloorplanDocument | null;
          };
          nextDocument = data.document ?? null;
          nextSource = data.sourceDocument ?? null;
        } catch (error) {
          // No saved document yet is a normal state; anything else is a real failure.
          if (!(error instanceof ApiError && error.kind === "not-found")) {
            throw error;
          }
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
        setSourceDocument(nextSource);
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
      setHandleScale(canvas.getWidth() / size.width);
      canvas.getActiveObject()?.setCoords();
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
    (point: { x: number; y: number }, modifiers: { shift?: boolean } = {}) => {
      if (!document) {
        return;
      }

      if (activeTool === "eraser" || activeTool === "select") {
        return;
      }

      // On a plan with a scale (a scan), new things get real sizes and measured labels; on any
      // plan, built-in sizes are fitted to the canvas.
      const pxPerMeter = document.scale?.pxPerMeter;
      const sizeScale = defaultObjectScale(document.canvas.width);

      if (activeTool === "wall") {
        if (!placementStartRef.current) {
          placementStartRef.current = point;
          return;
        }

        const start = placementStartRef.current;
        // Real wall thickness on a plan with a scale; the house stroke otherwise.
        const strokeWidth = pxPerMeter ? Math.max(SM_EDITOR.wallStroke, REAL_SIZE_M.wallThickness * pxPerMeter) : SM_EDITOR.wallStroke;
        const walls = document.objects.flatMap((object) => (object.type === "wall" ? [wallCentreLine(object)] : []));
        const wall = wallFromClicks(start, point, {
          strokeWidth,
          walls,
          reach: canvasPixels(WALL_SNAP_SCREEN_PIXELS),
          straight: Boolean(modifiers.shift),
        });
        if (Math.hypot(wall.x2 - wall.x, wall.y2 - wall.y) < strokeWidth) {
          return;
        }
        addObject({ ...createDefaultWall(wall.x, wall.y), ...wall } as FloorplanObject);
        // The next wall carries on from this one's end, until Escape or another tool.
        placementStartRef.current = { x: wall.x2 + strokeWidth / 2, y: wall.y2 + strokeWidth / 2 };
        return;
      }

      if (activeTool === "dimension") {
        if (!placementStartRef.current) {
          placementStartRef.current = point;
          return;
        }

        const start = placementStartRef.current;
        placementStartRef.current = null;

        const line = { x: start.x, y: start.y, x2: point.x, y2: point.y };

        addObject({
          ...createDefaultDimension(start.x, start.y),
          x2: point.x,
          y2: point.y,
          // A scanned plan knows its scale, so the measurement can be written for you.
          ...(document.scale ? { label: formatMeters(lineLengthInMeters(document.scale, line)) } : {}),
        } as FloorplanObject);
        setActiveTool("select");
        return;
      }

      switch (activeTool) {
        case "roomLabel":
          addObject(createDefaultRoomLabel(point.x, point.y));
          break;
        case "door": {
          const door = createDefaultDoor(point.x, point.y, sizeScale);
          addObject(
            pxPerMeter ? ({ ...door, width: REAL_SIZE_M.doorWidth * pxPerMeter } as FloorplanObject) : door,
          );
          break;
        }
        case "window": {
          const windowObject = createDefaultWindow(point.x, point.y, sizeScale);
          addObject(
            pxPerMeter
              ? ({
                  ...windowObject,
                  width: REAL_SIZE_M.windowWidth * pxPerMeter,
                  height: Math.max(REAL_SIZE_M.windowDepth * pxPerMeter, 6),
                } as FloorplanObject)
              : windowObject,
          );
          break;
        }
        case "stair": {
          const stair = createDefaultStair(point.x, point.y, sizeScale);
          addObject(
            pxPerMeter
              ? ({
                  ...stair,
                  width: REAL_SIZE_M.stairWidth * pxPerMeter,
                  height: REAL_SIZE_M.stairLength * pxPerMeter,
                } as FloorplanObject)
              : stair,
          );
          break;
        }
        case "symbol": {
          const symbol = getSymbolById(selectedSymbolId);
          addObject(
            createDefaultSymbol(
              point.x,
              point.y,
              selectedSymbolId,
              (symbol?.defaultWidth ?? 40) * sizeScale,
              (symbol?.defaultHeight ?? 40) * sizeScale,
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
              (furniture?.defaultWidth ?? 48) * sizeScale,
              (furniture?.defaultHeight ?? 48) * sizeScale,
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

    // A scan goes back to what was imported; any other plan is cleared.
    const nextDocument = touchDocument(originalDocument(currentDocument, sourceDocument));

    documentRef.current = nextDocument;
    commitDocument(nextDocument);
    setSelectedObjectId(null);
    setRenderRevision((version) => version + 1);
    return true;
  }, [commitDocument, sourceDocument]);

  const canResetToOriginal = Boolean(document && (document.objects.length > 0 || sourceDocument));

  const saveDocument = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !document) {
      return false;
    }

    setIsSaving(true);
    try {
      const latestDocument = syncCanvasToDocument(canvas, document);
      await apiFetch("/api/floorplan-document", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageId: approvedImage.id,
          imagePath: approvedImage.file_path,
          document: latestDocument,
        }),
      });

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

  useEffect(() => {
    showGuidesRef.current = showGuides;
    if (canvasRef.current) drawGuides(canvasRef.current, documentRef.current, showGuides);
  }, [showGuides]);

  /** A quarter turn of the whole plan, refitted to the page: one step to undo. */
  const rotatePlan = useCallback(() => {
    const canvas = canvasRef.current;
    const currentDocument = documentRef.current;
    if (!canvas || !currentDocument?.drawingArea) {
      return;
    }

    const nextDocument = touchDocument(rotatePlanQuarterTurn(syncCanvasToDocument(canvas, currentDocument)));
    documentRef.current = nextDocument;
    commitDocument(nextDocument);
    setSelectedObjectId(null);
    setRenderRevision((version) => version + 1);
  }, [commitDocument]);

  // Only blank and scanned plans know their drawing area; an AI-redrawn image cannot turn.
  const canRotatePlan = Boolean(document?.drawingArea && document.objects.length > 0);

  const publishFlattenedImage = useCallback(async (houseText?: HouseText) => {
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
      houseText,
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
      await apiFetch(`/api/floorplan-document?${params.toString()}`, { method: "DELETE" });

      return true;
    } catch (error) {
      skipPersistRef.current = false;
      onError(error instanceof Error ? error.message : "Kunde inte ta bort planritningsdata.");
      return false;
    }
  }, [approvedImage.file_path, approvedImage.id, onError]);

  useLayoutEffect(() => {
    saveDocumentRef.current = saveDocument;
  });

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
      // Plain fetch on purpose: this fires while the page is being torn down, where the
      // shared client's sign-out-on-401 redirect would be both useless and disruptive.
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

      // Escape steps back one level: a wall or measurement half-placed, then the selection,
      // then the tool.
      if (key === "escape") {
        if (placementStartRef.current) {
          placementStartRef.current = null;
        } else if (selectedObjectId) {
          canvasRef.current?.discardActiveObject();
          canvasRef.current?.requestRenderAll();
          setSelectedObjectId(null);
        } else if (activeTool !== "select") {
          setActiveTool("select");
        }
        return;
      }

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
    rotatePlan,
    canRotatePlan,
    hasGuides: Boolean(document?.guides?.meshWindows?.length),
    showGuides,
    setShowGuides,
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

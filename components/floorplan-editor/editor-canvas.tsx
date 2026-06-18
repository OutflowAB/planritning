"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Canvas } from "fabric";

import type { FloorplanEditorController } from "@/components/floorplan-editor/hooks/use-floorplan-editor";
import { configureCanvasSelectionStyle, configureCanvasToolMode, getEraserCursorMetrics } from "@/lib/floorplan/fabric/sync";
import { CANVA_PURPLE, installCanvaSelectionStyle } from "@/lib/floorplan/fabric/canva-controls";
import { installObjectSnapping } from "@/lib/floorplan/fabric/object-snapping";
import { SM_EDITOR } from "@/lib/sm-floorplan-layout";

type EditorCanvasProps = {
  controller: FloorplanEditorController;
};

const CANVAS_PADDING_PX = 24;

type ViewportSize = {
  width: number;
  height: number;
};

type ZoomAnchor = {
  ratioX: number;
  ratioY: number;
  anchorClientX: number;
  anchorClientY: number;
};

type LayoutSnapshot = {
  displaySize: ViewportSize;
  boxLeft: number;
  boxTop: number;
  zoomLevel: number;
};

/** Skala så hela planritningen får plats (contain) inom tillgänglig yta. */
function computeContainScale(
  viewport: ViewportSize,
  canvasWidth: number,
  canvasHeight: number,
) {
  const innerWidth = Math.max(viewport.width - CANVAS_PADDING_PX * 2, 1);
  const innerHeight = Math.max(viewport.height - CANVAS_PADDING_PX * 2, 1);
  const scaleX = innerWidth / canvasWidth;
  const scaleY = innerHeight / canvasHeight;
  return Math.min(1, scaleX, scaleY);
}

function getTouchDistance(touches: TouchList) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function getTouchCenter(touches: TouchList) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function isPinchZoomWheel(event: WheelEvent) {
  return event.ctrlKey || event.metaKey;
}

function createZoomAnchor(
  anchorClientX: number,
  anchorClientY: number,
  boxLeft: number,
  boxTop: number,
  displayWidth: number,
  displayHeight: number,
): ZoomAnchor {
  return {
    ratioX: (anchorClientX - boxLeft) / displayWidth,
    ratioY: (anchorClientY - boxTop) / displayHeight,
    anchorClientX,
    anchorClientY,
  };
}

type EraserCursorState = {
  x: number;
  y: number;
  size: number;
  visible: boolean;
};

export function EditorCanvas({ controller }: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef(controller);
  const paintGenerationRef = useRef(0);
  const pinchStateRef = useRef<{ distance: number; zoom: number } | null>(null);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const lastEraserPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const layoutSnapshotRef = useRef<LayoutSnapshot>({
    displaySize: { width: 0, height: 0 },
    boxLeft: 0,
    boxTop: 0,
    zoomLevel: 1,
  });
  const [displaySize, setDisplaySize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [eraserCursor, setEraserCursor] = useState<EraserCursorState>({
    x: 0,
    y: 0,
    size: 0,
    visible: false,
  });

  controllerRef.current = controller;

  const isEraserActive = controller.activeTool === "eraser";

  function syncEraserCursorFromPointer(
    pointer: { clientX: number; clientY: number },
    visible = true,
  ) {
    const canvas = controllerRef.current.canvasRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!canvas || !wrapper) {
      return;
    }

    const metrics = getEraserCursorMetrics(canvas, wrapper, pointer);
    setEraserCursor({
      ...metrics,
      visible,
    });
  }

  const contentWidth = Math.max(
    displaySize.width + CANVAS_PADDING_PX * 2,
    viewportSize.width,
  );
  const contentHeight = Math.max(
    displaySize.height + CANVAS_PADDING_PX * 2,
    viewportSize.height,
  );
  const canvasLeft = (contentWidth - displaySize.width) / 2;
  const canvasTop = (contentHeight - displaySize.height) / 2;

  function prepareZoomAnchor(anchorClientX: number, anchorClientY: number) {
    const canvasBox = canvasWrapperRef.current;
    const snapshot = layoutSnapshotRef.current;
    if (!canvasBox || snapshot.displaySize.width <= 0) {
      return;
    }

    zoomAnchorRef.current = createZoomAnchor(
      anchorClientX,
      anchorClientY,
      snapshot.boxLeft,
      snapshot.boxTop,
      snapshot.displaySize.width,
      snapshot.displaySize.height,
    );
  }

  useEffect(() => {
    const element = canvasElementRef.current;
    const document = controllerRef.current.document;
    if (!element || !document) {
      return;
    }

    installCanvaSelectionStyle();

    const canvas = new Canvas(element, {
      width: document.canvas.width,
      height: document.canvas.height,
      backgroundColor: SM_EDITOR.background,
      selection: true,
      selectionColor: "rgba(139, 61, 255, 0.08)",
      selectionBorderColor: CANVA_PURPLE,
      preserveObjectStacking: true,
      enableRetinaScaling: true,
    });

    configureCanvasSelectionStyle(canvas);

    const snapping = installObjectSnapping(canvas);

    controllerRef.current.registerCanvas(canvas);

    function handleMouseDown(options: { e: Event }) {
      const activeCanvas = controllerRef.current.canvasRef.current;
      const activeTool = controllerRef.current.activeTool;
      if (!activeCanvas || activeTool === "eraser" || activeTool === "select") {
        return;
      }

      const pointer = activeCanvas.getScenePoint(options.e as MouseEvent);
      controllerRef.current.handleCanvasPointer({ x: pointer.x, y: pointer.y });
    }

    canvas.on("mouse:down", handleMouseDown);

    return () => {
      paintGenerationRef.current += 1;
      canvas.off("mouse:down", handleMouseDown);
      snapping.dispose();
      controllerRef.current.registerCanvas(null);
      void canvas.dispose();
    };
  }, [controller.document?.canvas.width, controller.document?.canvas.height]);

  useEffect(() => {
    const canvas = controllerRef.current.canvasRef.current;
    if (!canvas) {
      return;
    }

    configureCanvasToolMode(canvas, controllerRef.current.activeTool);
  }, [
    controller.activeTool,
    controller.canvasReadyVersion,
    controller.document?.canvas.height,
    controller.document?.canvas.width,
    controller.renderRevision,
  ]);

  useEffect(() => {
    const canvas = controllerRef.current.canvasRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!canvas || !wrapper || !isEraserActive) {
      setEraserCursor((previous) =>
        previous.visible ? { ...previous, visible: false } : previous,
      );
      return;
    }

    function handleMouseMove(options: { e: MouseEvent | TouchEvent }) {
      if (!(options.e instanceof MouseEvent)) {
        return;
      }

      lastEraserPointerRef.current = {
        clientX: options.e.clientX,
        clientY: options.e.clientY,
      };
      syncEraserCursorFromPointer(options.e);
    }

    function hideEraserCursor() {
      lastEraserPointerRef.current = null;
      setEraserCursor((previous) =>
        previous.visible ? { ...previous, visible: false } : previous,
      );
    }

    canvas.on("mouse:move", handleMouseMove);
    canvas.on("mouse:out", hideEraserCursor);

    return () => {
      canvas.off("mouse:move", handleMouseMove);
      canvas.off("mouse:out", hideEraserCursor);
    };
  }, [
    isEraserActive,
    controller.canvasReadyVersion,
    displaySize.height,
    displaySize.width,
  ]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node || !controller.document) {
      return;
    }

    function updateLayout() {
      const currentNode = containerRef.current;
      const currentDocument = controllerRef.current.document;
      if (!currentNode || !currentDocument) {
        return;
      }

      const viewportWidth = currentNode.clientWidth;
      const viewportHeight = currentNode.clientHeight;
      if (viewportWidth <= 0 || viewportHeight <= 0) {
        return;
      }

      setViewportSize((previous) =>
        previous.width === viewportWidth && previous.height === viewportHeight
          ? previous
          : { width: viewportWidth, height: viewportHeight },
      );

      const nextScale =
        computeContainScale(
          { width: viewportWidth, height: viewportHeight },
          currentDocument.canvas.width,
          currentDocument.canvas.height,
        ) * controllerRef.current.zoomLevel;

      const width = Math.floor(currentDocument.canvas.width * nextScale);
      const height = Math.floor(currentDocument.canvas.height * nextScale);
      setDisplaySize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    }

    updateLayout();

    const observer = new ResizeObserver(updateLayout);
    observer.observe(node);
    window.addEventListener("resize", updateLayout);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateLayout);
    };
  }, [
    controller.document?.canvas.width,
    controller.document?.canvas.height,
    controller.zoomLevel,
  ]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvasBox = canvasWrapperRef.current;
    if (!container || !canvasBox || displaySize.width <= 0 || displaySize.height <= 0) {
      return;
    }

    const previous = layoutSnapshotRef.current;
    const boxRect = canvasBox.getBoundingClientRect();
    const zoomChanged = previous.zoomLevel !== controller.zoomLevel;
    const sizeChanged =
      previous.displaySize.width !== displaySize.width ||
      previous.displaySize.height !== displaySize.height;

    if (zoomChanged && sizeChanged && previous.displaySize.width > 0) {
      let anchor = zoomAnchorRef.current;
      if (!anchor) {
        const containerRect = container.getBoundingClientRect();
        anchor = createZoomAnchor(
          containerRect.left + containerRect.width / 2,
          containerRect.top + containerRect.height / 2,
          previous.boxLeft,
          previous.boxTop,
          previous.displaySize.width,
          previous.displaySize.height,
        );
      } else {
        zoomAnchorRef.current = null;
      }

      const desiredLocalX = anchor.ratioX * displaySize.width;
      const desiredLocalY = anchor.ratioY * displaySize.height;
      const currentLocalX = anchor.anchorClientX - boxRect.left;
      const currentLocalY = anchor.anchorClientY - boxRect.top;

      container.scrollLeft += currentLocalX - desiredLocalX;
      container.scrollTop += currentLocalY - desiredLocalY;
    }

    layoutSnapshotRef.current = {
      displaySize: { ...displaySize },
      boxLeft: boxRect.left,
      boxTop: boxRect.top,
      zoomLevel: controller.zoomLevel,
    };
  }, [controller.zoomLevel, displaySize.height, displaySize.width]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length !== 2) {
        if (event.touches.length < 2) {
          pinchStateRef.current = null;
        }
        return;
      }

      event.preventDefault();
      pinchStateRef.current = {
        distance: getTouchDistance(event.touches),
        zoom: controllerRef.current.zoomLevel,
      };
    }

    function handleTouchMove(event: TouchEvent) {
      const pinchState = pinchStateRef.current;
      if (!pinchState || event.touches.length !== 2) {
        return;
      }

      event.preventDefault();
      const distance = getTouchDistance(event.touches);
      if (pinchState.distance <= 0) {
        return;
      }

      const center = getTouchCenter(event.touches);
      prepareZoomAnchor(center.x, center.y);
      controllerRef.current.setZoomLevel(pinchState.zoom * (distance / pinchState.distance));
    }

    function handleTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) {
        pinchStateRef.current = null;
      }
    }

    function handleWheel(event: WheelEvent) {
      if (!isPinchZoomWheel(event)) {
        return;
      }

      event.preventDefault();
      prepareZoomAnchor(event.clientX, event.clientY);
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      controllerRef.current.setZoomLevel((current) => current * factor);
    }

    const touchOptions = { capture: true, passive: false } as const;

    node.addEventListener("touchstart", handleTouchStart, touchOptions);
    node.addEventListener("touchmove", handleTouchMove, touchOptions);
    node.addEventListener("touchend", handleTouchEnd, touchOptions);
    node.addEventListener("touchcancel", handleTouchEnd, touchOptions);
    node.addEventListener("wheel", handleWheel, { capture: true, passive: false });

    return () => {
      node.removeEventListener("touchstart", handleTouchStart, touchOptions);
      node.removeEventListener("touchmove", handleTouchMove, touchOptions);
      node.removeEventListener("touchend", handleTouchEnd, touchOptions);
      node.removeEventListener("touchcancel", handleTouchEnd, touchOptions);
      node.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, []);

  useEffect(() => {
    const currentController = controllerRef.current;
    if (
      displaySize.width <= 0 ||
      displaySize.height <= 0 ||
      !currentController.canvasRef.current
    ) {
      return;
    }

    currentController.applyDisplayScale(displaySize);

    const lastPointer = lastEraserPointerRef.current;
    if (isEraserActive && lastPointer) {
      syncEraserCursorFromPointer(lastPointer);
    }
  }, [displaySize.height, displaySize.width, isEraserActive]);

  useEffect(() => {
    const currentController = controllerRef.current;
    if (
      !currentController.document ||
      displaySize.width <= 0 ||
      displaySize.height <= 0 ||
      !currentController.canvasRef.current
    ) {
      return;
    }

    let active = true;
    const generation = ++paintGenerationRef.current;

    async function paint() {
      const canvas = currentController.canvasRef.current;
      if (!canvas) {
        return;
      }

      currentController.applyDisplayScale(displaySize);
      await currentController.renderCanvas();
      if (
        !active ||
        generation !== paintGenerationRef.current ||
        currentController.canvasRef.current !== canvas
      ) {
        return;
      }
      currentController.applyDisplayScale(displaySize);
      if (currentController.canvasRef.current) {
        configureCanvasSelectionStyle(canvas);
        configureCanvasToolMode(canvas, currentController.activeTool);
      }
    }

    void paint();

    return () => {
      active = false;
    };
  }, [
    controller.canvasReadyVersion,
    controller.renderRevision,
    controller.document?.canvas.height,
    controller.document?.canvas.width,
    displaySize.height,
    displaySize.width,
  ]);

  if (!controller.document) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full overflow-auto bg-[#ece7df]"
      style={{ touchAction: "pan-x pan-y" }}
    >
      <div
        ref={scrollContentRef}
        className="relative"
        style={{
          width: contentWidth > 0 ? contentWidth : undefined,
          height: contentHeight > 0 ? contentHeight : undefined,
          minWidth: viewportSize.width > 0 ? viewportSize.width : undefined,
          minHeight: viewportSize.height > 0 ? viewportSize.height : undefined,
        }}
      >
        <div
          ref={canvasWrapperRef}
          className={`absolute overflow-hidden border border-[#d8d2c8] bg-[#ece7df] shadow-sm [&_.canvas-container]:!h-full [&_.canvas-container]:!w-full ${
            isEraserActive ? "cursor-none" : ""
          }`}
          style={{
            left: canvasLeft,
            top: canvasTop,
            width: displaySize.width > 0 ? displaySize.width : undefined,
            height: displaySize.height > 0 ? displaySize.height : undefined,
          }}
        >
          <canvas ref={canvasElementRef} className="block h-full w-full" />
          {isEraserActive && eraserCursor.visible && eraserCursor.size > 0 ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-10 box-border rounded-full"
              style={{
                width: eraserCursor.size,
                height: eraserCursor.size,
                left: eraserCursor.x - eraserCursor.size / 2,
                top: eraserCursor.y - eraserCursor.size / 2,
                border: `${SM_EDITOR.eraserCursorBorderWidth}px solid ${SM_EDITOR.eraserCursorBorderColor}`,
                backgroundColor: "rgba(225, 212, 200, 0.25)",
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

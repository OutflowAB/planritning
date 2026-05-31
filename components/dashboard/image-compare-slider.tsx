"use client";

import { PointerEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";

import {
  preventImageContextMenu,
  WatermarkOverlay,
} from "@/components/dashboard/watermark-overlay";

type ImageCompareSliderProps = {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt?: string;
  afterAlt?: string;
  className?: string;
  onClick?: () => void;
  protectAfterImage?: boolean;
  loadingFallback?: ReactNode;
};

const IMAGE_CLASS_NAME = "block h-auto w-auto max-h-[min(60vh,640px)] max-w-full bg-white";

function preloadImage(src: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Kunde inte ladda jämförelsebilden."));
    image.src = src;
  });
}

export function ImageCompareSlider({
  beforeSrc,
  afterSrc,
  beforeAlt = "Original",
  afterAlt = "Resultat",
  className = "",
  onClick,
  protectAfterImage = false,
  loadingFallback = null,
}: ImageCompareSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 });
  const [isTransitionEnabled, setIsTransitionEnabled] = useState(false);
  const [imagesReady, setImagesReady] = useState(false);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);

  const syncRenderedSize = useCallback(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const afterImage = element.querySelector<HTMLImageElement>("[data-compare-after='true']");
    if (!afterImage || afterImage.offsetWidth <= 0) {
      return;
    }

    setRenderedSize({
      width: afterImage.offsetWidth,
      height: afterImage.offsetHeight,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setImagesReady(false);
    setPosition(50);
    setIsTransitionEnabled(false);
    setRenderedSize({ width: 0, height: 0 });

    void Promise.all([preloadImage(afterSrc), preloadImage(beforeSrc)])
      .then(() => {
        if (!cancelled) {
          setImagesReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImagesReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [beforeSrc, afterSrc]);

  useEffect(() => {
    if (!imagesReady) {
      return;
    }

    const revealTimer = window.setTimeout(() => {
      setIsTransitionEnabled(true);
      setPosition(0);
    }, 300);

    return () => window.clearTimeout(revealTimer);
  }, [imagesReady, beforeSrc, afterSrc]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !imagesReady) {
      return;
    }

    syncRenderedSize();
    const observer = new ResizeObserver(syncRenderedSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [imagesReady, syncRenderedSize, beforeSrc, afterSrc]);

  const transitionStyle = isTransitionEnabled
    ? { transition: "width 0.8s ease-in-out, left 0.8s ease-in-out" }
    : undefined;

  const updatePositionFromClientX = useCallback((clientX: number) => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const nextPosition = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, nextPosition)));
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    isDraggingRef.current = true;
    didDragRef.current = false;
    setIsTransitionEnabled(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePositionFromClientX(event.clientX);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) {
      return;
    }

    didDragRef.current = true;
    updatePositionFromClientX(event.clientX);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (isDraggingRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    isDraggingRef.current = false;
  }

  function handleClick() {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    onClick?.();
  }

  if (!imagesReady) {
    return loadingFallback ?? (
      <div
        className="flex min-h-[min(60vh,640px)] w-full items-center justify-center bg-[#f0ece6]"
        aria-busy="true"
        aria-live="polite"
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative mx-auto block w-fit max-w-full touch-none select-none overflow-hidden bg-white leading-none ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
      onContextMenu={protectAfterImage ? preventImageContextMenu : undefined}
      role="slider"
      aria-label="Jämför original och resultat"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position)}
    >
      <div className="relative w-fit max-w-full">
        <img
          src={afterSrc}
          alt={afterAlt}
          draggable={false}
          data-compare-after="true"
          onLoad={syncRenderedSize}
          className={IMAGE_CLASS_NAME}
        />
        {protectAfterImage ? <WatermarkOverlay /> : null}
      </div>

      <div
        className="absolute inset-y-0 left-0 overflow-hidden"
        style={{ width: `${position}%`, ...transitionStyle }}
        aria-hidden="true"
      >
        <div
          className="relative h-full"
          style={{
            width: renderedSize.width > 0 ? renderedSize.width : "100%",
            height: renderedSize.height > 0 ? renderedSize.height : "100%",
          }}
        >
          <img
            src={beforeSrc}
            alt={beforeAlt}
            draggable={false}
            onLoad={syncRenderedSize}
            className="absolute left-0 top-0 max-w-none"
            style={{
              width: renderedSize.width > 0 ? renderedSize.width : "100%",
              height: renderedSize.height > 0 ? renderedSize.height : "100%",
            }}
          />
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)]"
        style={{ left: `${position}%`, ...transitionStyle }}
        aria-hidden="true"
      >
        <div className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#d8d2c8] bg-white shadow-sm">
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-[#6a6258]">
            <span aria-hidden="true">‹</span>
            <span aria-hidden="true">›</span>
          </span>
        </div>
      </div>
    </div>
  );
}

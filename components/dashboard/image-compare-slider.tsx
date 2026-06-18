"use client";

import { PointerEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";

import {
  preventImageContextMenu,
  warmWatermarkImage,
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
  onReadyChange?: (ready: boolean) => void;
  playEntranceAnimation?: boolean;
};

const ENTRANCE_ANIMATION_MS = 900;

const IMAGE_CLASS_NAME = "block h-auto w-auto max-h-[min(60vh,640px)] max-w-full bg-white";

const loadedCompareImageSrcs = new Set<string>();

function preloadImage(src: string) {
  if (loadedCompareImageSrcs.has(src)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      loadedCompareImageSrcs.add(src);
      resolve();
    };
    image.onerror = () => reject(new Error("Kunde inte ladda jämförelsebilden."));
    image.src = src;
  });
}

export function warmCompareImageSrc(src: string) {
  void preloadImage(src).catch(() => undefined);
}

export function warmCompareImageCache(beforeSrc: string, afterSrc: string) {
  warmWatermarkImage();
  warmCompareImageSrc(beforeSrc);
  warmCompareImageSrc(afterSrc);
}

export function areCompareImagesCached(beforeSrc: string, afterSrc: string) {
  return loadedCompareImageSrcs.has(beforeSrc) && loadedCompareImageSrcs.has(afterSrc);
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
  onReadyChange,
  playEntranceAnimation = true,
}: ImageCompareSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 });
  const [isTransitionEnabled, setIsTransitionEnabled] = useState(false);
  const [isEntranceAnimating, setIsEntranceAnimating] = useState(false);
  const [imagesReady, setImagesReady] = useState(
    () => loadedCompareImageSrcs.has(afterSrc) && loadedCompareImageSrcs.has(beforeSrc),
  );
  const entrancePlayedForSrcRef = useRef<string | null>(null);
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
    const bothCached =
      loadedCompareImageSrcs.has(afterSrc) && loadedCompareImageSrcs.has(beforeSrc);

    if (!bothCached) {
      setImagesReady(false);
      setIsTransitionEnabled(false);
      setIsEntranceAnimating(false);
      setRenderedSize({ width: 0, height: 0 });
      setPosition(50);
      entrancePlayedForSrcRef.current = null;
    } else {
      setImagesReady(true);
    }

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
  }, [beforeSrc, afterSrc, playEntranceAnimation]);

  useEffect(() => {
    onReadyChange?.(imagesReady);
  }, [imagesReady, onReadyChange]);

  useEffect(() => {
    if (!imagesReady || !playEntranceAnimation || renderedSize.width === 0) {
      return;
    }

    const srcKey = `${beforeSrc}\0${afterSrc}`;
    if (entrancePlayedForSrcRef.current === srcKey) {
      return;
    }

    entrancePlayedForSrcRef.current = srcKey;
    setPosition(50);
    setIsTransitionEnabled(false);
    setIsEntranceAnimating(true);

    const revealTimer = window.setTimeout(() => {
      setIsTransitionEnabled(true);
      setPosition(0);
    }, 120);

    const settleTimer = window.setTimeout(() => {
      setIsEntranceAnimating(false);
      setIsTransitionEnabled(false);
    }, 120 + ENTRANCE_ANIMATION_MS);

    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(settleTimer);
      entrancePlayedForSrcRef.current = null;
    };
  }, [imagesReady, beforeSrc, afterSrc, playEntranceAnimation, renderedSize.width]);

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
    ? { transition: `width ${ENTRANCE_ANIMATION_MS}ms ease-in-out, left ${ENTRANCE_ANIMATION_MS}ms ease-in-out` }
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

  if (!imagesReady && !protectAfterImage) {
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
      className={`relative mx-auto block w-fit max-w-full touch-none select-none overflow-hidden bg-white leading-none ${
        onClick ? "cursor-pointer" : ""
      } ${className} ${imagesReady && !isEntranceAnimating ? "" : "pointer-events-none"}`}
      onPointerDown={imagesReady && !isEntranceAnimating ? handlePointerDown : undefined}
      onPointerMove={imagesReady && !isEntranceAnimating ? handlePointerMove : undefined}
      onPointerUp={imagesReady && !isEntranceAnimating ? handlePointerUp : undefined}
      onPointerCancel={imagesReady && !isEntranceAnimating ? handlePointerUp : undefined}
      onClick={imagesReady && !isEntranceAnimating ? handleClick : undefined}
      onContextMenu={protectAfterImage ? preventImageContextMenu : undefined}
      role="slider"
      aria-label="Jämför original och resultat"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position)}
      aria-busy={!imagesReady}
    >
      <div className="relative w-fit max-w-full min-h-[min(60vh,640px)]">
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

      {imagesReady ? (
        <>
          <div
            className="absolute inset-y-0 left-0 z-[8] overflow-hidden"
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
        </>
      ) : null}
    </div>
  );
}

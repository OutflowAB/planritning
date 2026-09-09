"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * A thumbnail that occupies its final size before the image arrives.
 *
 * Sizing an image with `w-auto` and a guessed aspect ratio means the box is the wrong shape
 * until the file loads, so every card resizes under the cursor as thumbnails trickle in. Here
 * the frame is a fixed height the caller decides, the image is laid in with `fill` and
 * letterboxed, and a skeleton of exactly that size covers it until the load event fires.
 */

type ThumbnailImageProps = {
  src: string | null | undefined;
  alt: string;
  /** Tailwind height class for the frame, e.g. `h-[220px]`. Must be a fixed height. */
  heightClassName: string;
  /** Only meaningful for optimised sources; the API serves pre-sized files. */
  sizes?: string;
  priority?: boolean;
  emptyLabel?: string;
  frameClassName?: string;
  onLoad?: () => void;
  /** Fires on hover or focus — the moment to warm the image the user is about to open. */
  onPrefetch?: () => void;
};

export function ThumbnailImage({
  src,
  alt,
  heightClassName,
  sizes,
  priority = false,
  emptyLabel = "Ingen bildförhandsvisning",
  frameClassName = "border border-[#d8d2c8] bg-white",
  onLoad,
  onPrefetch,
}: ThumbnailImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  if (!src) {
    return (
      <div
        className={`flex ${heightClassName} w-full items-center justify-center rounded-none border border-[#d8d2c8] bg-[#f7f4ef] text-sm text-[#7b746a]`}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      className={`relative ${heightClassName} w-full overflow-hidden rounded-none ${frameClassName}`}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
    >
      {isLoaded ? null : (
        <div
          className="absolute inset-0 animate-pulse bg-[#ece7df]"
          aria-hidden="true"
          data-testid="thumbnail-skeleton"
        />
      )}
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized
        className={`object-contain transition-opacity duration-200 ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
        onLoad={() => {
          setIsLoaded(true);
          onLoad?.();
        }}
      />
    </div>
  );
}

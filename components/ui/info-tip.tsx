"use client";

import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { ReactNode, useEffect, useId, useRef, useState } from "react";

type InfoTipProps = {
  /** What the icon is about, for screen readers ("Om Polycam-länkar"). */
  label: string;
  children: ReactNode;
  align?: "left" | "right";
};

/**
 * A small (i) that explains something in place. Opens on hover, focus or tap; Escape or a
 * click elsewhere closes it.
 */
export function InfoTip({ label, children, align = "left" }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition hover:text-stone-700"
      >
        <InformationCircleIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full z-50 mt-2 w-72 rounded-lg border border-stone-200 bg-white p-3 text-left text-xs font-normal leading-[1.125rem] text-stone-600 shadow-[0_12px_32px_-8px_rgba(28,25,23,0.22)] ${
            align === "right" ? "right-0" : "-left-2"
          }`}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}

"use client";

import { Check, Pencil } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";

import { IMAGE_LABEL_MAX_LENGTH, normaliseImageLabel } from "@/lib/image-label";

type EditableTitleProps = {
  /** The name given so far; null when unnamed. */
  value: string | null;
  /** What shows when unnamed, e.g. "Bild 285". */
  fallback: string;
  /** Saves the new name (null clears it). Resolves to false if it could not be saved. */
  onSave: (next: string | null) => Promise<boolean>;
  className?: string;
};

/**
 * A card title that turns into a field on click. Enter or leaving the field saves, Escape
 * cancels. An unnamed item reads as its fallback with a quiet "Namnge" hint on hover.
 */
export function EditableTitle({ value, fallback, onSave, className = "" }: EditableTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function startEditing() {
    setDraft(value ?? "");
    setFailed(false);
    setIsEditing(true);
  }

  async function commit() {
    const next = normaliseImageLabel(draft);
    if (next === (value ?? null)) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    const saved = await onSave(next);
    setIsSaving(false);
    setFailed(!saved);
    if (saved) {
      setIsEditing(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setFailed(false);
      setIsEditing(false);
    }
  }

  if (isEditing) {
    return (
      <div className={className}>
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={IMAGE_LABEL_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void commit()}
            disabled={isSaving}
            placeholder="Adress eller namn"
            aria-label="Namn på planritningen"
            className="h-7 w-full min-w-0 rounded-md border border-accent bg-white px-2 text-sm font-medium text-stone-900 outline-none ring-4 ring-accent/15 placeholder:font-normal placeholder:text-stone-400"
          />
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-stone-400" aria-hidden="true">
            <Check size={14} />
          </span>
        </div>
        {failed ? (
          <p className="mt-1 text-xs text-red-600" role="alert">
            Kunde inte spara namnet.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title={value ? "Byt namn" : "Namnge"}
      className={`group/title flex max-w-full items-center gap-1.5 rounded-md text-left ${className}`}
    >
      <span className={`truncate text-sm font-medium ${value ? "text-stone-900" : "text-stone-700"}`}>
        {value ?? fallback}
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-xs font-normal text-stone-400 group-hover/title:inline-flex group-focus-visible/title:inline-flex">
        <Pencil size={11} aria-hidden="true" />
        {value ? null : "Namnge"}
      </span>
    </button>
  );
}

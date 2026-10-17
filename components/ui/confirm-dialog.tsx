"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

type Pending = { message: string; confirmLabel: string; resolve: (answer: boolean) => void };

/**
 * A confirmation shown in the page, answered with a promise: `if (!(await confirm("...")))`.
 * The browser's own confirm() is not used because embedded browsers (such as the desktop
 * app's) do not show it and answer "no", which made every delete silently do nothing.
 */
export function useConfirm(): {
  confirm: (message: string, confirmLabel?: string) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback(
    (message: string, confirmLabel = "Ta bort") =>
      new Promise<boolean>((resolve) => setPending({ message, confirmLabel, resolve })),
    [],
  );

  const answer = useCallback(
    (value: boolean) => {
      pending?.resolve(value);
      setPending(null);
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") answer(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, answer]);

  const dialog = pending ? (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 py-6"
      onClick={() => answer(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-none border border-[#d8d2c8] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-describedby="confirm-dialog-message"
      >
        <div className="px-4 py-5">
          <p id="confirm-dialog-message" className="text-sm text-[#4d463f]">
            {pending.message}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => answer(false)}
            className="rounded-none border border-[#d8d2c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => answer(true)}
            className="rounded-none border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}

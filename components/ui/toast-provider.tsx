"use client";

import { X } from "lucide-react";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ToastVariant = "success" | "error";

type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 4_000;

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const [progress, setProgress] = useState(1);
  const [isHovered, setIsHovered] = useState(false);
  const remainingMsRef = useRef(TOAST_DURATION_MS);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  useEffect(() => {
    remainingMsRef.current = TOAST_DURATION_MS;
    setProgress(1);
  }, [toast.id]);

  useEffect(() => {
    if (isHovered) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastFrameTimeRef.current = null;
      return;
    }

    lastFrameTimeRef.current = performance.now();

    const tick = (now: number) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = now;
      }

      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;
      remainingMsRef.current = Math.max(0, remainingMsRef.current - delta);
      setProgress(remainingMsRef.current / TOAST_DURATION_MS);

      if (remainingMsRef.current <= 0) {
        onDismiss(toast.id);
        return;
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isHovered, onDismiss, toast.id]);

  const isSuccess = toast.variant === "success";

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`flex min-w-[280px] max-w-sm flex-col overflow-hidden rounded-none border text-sm shadow-[0_12px_40px_rgba(0,0,0,0.18)] ${
        isSuccess
          ? "border-[#d8d2c8] bg-[#f7f4ef] text-[#4d463f]"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <p className="flex-1 leading-snug">{toast.message}</p>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Stäng meddelande"
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center transition hover:opacity-70 ${
            isSuccess ? "text-[#6a6258]" : "text-red-700"
          }`}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="h-0.5 w-full" aria-hidden="true">
        <div
          className={`h-full w-full origin-left ${isSuccess ? "bg-[#5c544a]" : "bg-red-500"}`}
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, variant: ToastVariant = "success") => {
    if (!message.trim()) {
      return;
    }

    const id = crypto.randomUUID();
    setToasts((previous) => [...previous, { id, message, variant }]);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Meddelanden"
        className="pointer-events-none fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-[100] flex flex-col items-end gap-2 md:bottom-6"
      >
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} onDismiss={dismissToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider.");
  }

  return context;
}

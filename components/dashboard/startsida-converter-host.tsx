"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  ReactNode,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { FloorplanEnhancer } from "@/components/dashboard/floorplan-enhancer";
import {
  consumeStartsidaConverterMountKey,
  hasPendingConverterTransfer,
  hasUnfinishedConverterSession,
  markStartsidaConverterForReset,
} from "@/lib/startsida-converter-session";

type StartsidaConverterSlotContextValue = {
  setSlot: (element: HTMLElement | null) => void;
};

const StartsidaConverterSlotContext = createContext<StartsidaConverterSlotContextValue | null>(
  null,
);

function StartsidaConverterPortal({
  slot,
  fallbackEl,
}: {
  slot: HTMLElement | null;
  fallbackEl: HTMLDivElement | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromUploadParam = searchParams.get("fromUpload");
  const isStartsida = pathname === "/startsida";
  const [resetKey, setResetKey] = useState("persistent");
  // One stable element the converter always renders into. React remounts a portal's children
  // when the container changes, which wiped a running conversion on every navigation; instead
  // this element is moved between the page slot and the hidden fallback.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const parentEl = isStartsida && slot ? slot : fallbackEl;

  useEffect(() => {
    const element = document.createElement("div");
    element.className = "flex w-full justify-center";
    // Queued: creating DOM must not drive state during hydration.
    queueMicrotask(() => setContainer(element));
  }, []);

  useLayoutEffect(() => {
    if (container && parentEl && container.parentNode !== parentEl) {
      parentEl.appendChild(container);
    }
  }, [container, parentEl]);

  useEffect(() => {
    if (!isStartsida) {
      if (!hasUnfinishedConverterSession()) {
        markStartsidaConverterForReset();
      }
      return;
    }

    const nextKey = consumeStartsidaConverterMountKey(fromUploadParam);
    if (nextKey !== "initial") {
      // Queued: it reads sessionStorage, which must not drive state during hydration.
      queueMicrotask(() => setResetKey(nextKey));
    }
  }, [fromUploadParam, isStartsida]);

  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (
        !event.persisted ||
        hasPendingConverterTransfer(fromUploadParam) ||
        hasUnfinishedConverterSession()
      ) {
        return;
      }

      setResetKey(`reset-${Date.now()}`);
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [fromUploadParam]);

  if (!container) {
    return null;
  }

  return createPortal(<FloorplanEnhancer key={resetKey} />, container);
}

type StartsidaConverterProviderProps = {
  children: ReactNode;
};

export function StartsidaConverterProvider({ children }: StartsidaConverterProviderProps) {
  const pathname = usePathname();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [fallbackEl, setFallbackEl] = useState<HTMLDivElement | null>(null);
  const shouldHostConverter =
    pathname !== "/login" && !pathname.startsWith("/admin") && pathname !== "/";

  return (
    <StartsidaConverterSlotContext.Provider value={{ setSlot }}>
      {children}
      {shouldHostConverter ? (
        <>
          <div
            ref={setFallbackEl}
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 -z-50 opacity-0"
          />
          <Suspense fallback={null}>
            <StartsidaConverterPortal slot={slot} fallbackEl={fallbackEl} />
          </Suspense>
        </>
      ) : null}
    </StartsidaConverterSlotContext.Provider>
  );
}

export function StartsidaConverterSlot() {
  const context = useContext(StartsidaConverterSlotContext);
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!context) {
      return;
    }

    context.setSlot(slotRef.current);
    return () => {
      context.setSlot(null);
    };
  }, [context]);

  return <div ref={slotRef} className="flex w-full justify-center" />;
}

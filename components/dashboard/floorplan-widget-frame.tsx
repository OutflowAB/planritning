"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type FloorplanWidgetFrameProps = {
  className?: string;
};

const WIDGET_PATH = "/floorplan-widget/";

export function FloorplanWidgetFrame({ className }: FloorplanWidgetFrameProps) {
  const [isChecking, setIsChecking] = useState(true);
  const [isAvailable, setIsAvailable] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const frameClassName = useMemo(
    () =>
      `relative overflow-hidden rounded-lg border border-[#d8d2c8] bg-[#f7f4ef] ${className ?? ""}`,
    [className],
  );

  const checkWidget = useCallback(async () => {
    setIsChecking(true);
    setLoadError("");
    setIsLoaded(false);

    try {
      const response = await fetch(WIDGET_PATH, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Widget svarade med ${response.status}.`);
      }

      setIsAvailable(true);
    } catch {
      setIsAvailable(false);
      setLoadError(
        "Kunde inte nå floorplanconvert-widgeten. Starta den lokala Python-servern och försök igen.",
      );
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkWidget();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [checkWidget]);

  return (
    <div className={frameClassName}>
      {isAvailable ? (
        <>
          {!isLoaded ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#f7f4ef]/90">
              <p className="text-sm font-medium text-[#6a6258]">Laddar verktyget...</p>
            </div>
          ) : null}
          <iframe
            title="Floor Plan Converter"
            src={WIDGET_PATH}
            className="h-[840px] w-full bg-[#f5f0eb]"
            onLoad={() => setIsLoaded(true)}
          />
        </>
      ) : (
        <div className="space-y-3 p-6 text-left">
          <p className="text-sm font-medium text-[#4d463f]">
            Floor Plan Converter är inte tillgänglig ännu.
          </p>
          {loadError ? <p className="text-sm text-[#7b746a]">{loadError}</p> : null}
          <div className="rounded-md border border-[#d8d2c8] bg-white px-3 py-2">
            <p className="text-xs text-[#6a6258]">
              Starta widgeten i en separat terminal med:
            </p>
            <p className="mt-1 font-mono text-xs text-[#3d3a36]">
              cd floorplanconvert && source .venv/bin/activate && python server.py
            </p>
          </div>
          <button
            type="button"
            onClick={() => void checkWidget()}
            disabled={isChecking}
            className="rounded-md bg-[#5c544a] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isChecking ? "Kontrollerar..." : "Försök igen"}
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import { applyThemePreview, currentTheme, THEMES, type ThemeId } from "@/lib/themes";

/** The swatch for a theme: sidebar, primary and canvas side by side. */
const SWATCHES: Record<ThemeId, [string, string, string]> = {
  neutral: ["#fafaf9", "#1c1917", "#ffffff"],
  kund: ["#2a221b", "#6b5640", "#f8f5f1"],
  skog: ["#142b25", "#1f5141", "#f6f8f6"],
  marin: ["#111832", "#24397a", "#f6f7fb"],
};

function useTheme() {
  const [theme, setTheme] = useState<ThemeId>("neutral");
  useEffect(() => {
    // The boot script has already applied a previewed theme; read it back once mounted.
    const frame = window.requestAnimationFrame(() => setTheme(currentTheme()));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return [
    theme,
    (id: ThemeId) => {
      applyThemePreview(id);
      setTheme(id);
    },
  ] as const;
}

/** Large cards for the preview page. */
export function ThemeCards() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {THEMES.map((option) => {
        const [sidebar, primary, canvas] = SWATCHES[option.id];
        const selected = option.id === theme;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => setTheme(option.id)}
            aria-pressed={selected}
            className={`flex items-center gap-3 rounded-xl border bg-white p-3 text-left transition ${
              selected ? "border-primary ring-2 ring-primary/20" : "border-stone-200 hover:border-stone-300"
            }`}
          >
            <span className="flex h-12 w-20 shrink-0 overflow-hidden rounded-lg ring-1 ring-stone-200">
              <span className="w-1/3" style={{ background: sidebar }} />
              <span className="flex w-2/3 flex-col justify-end gap-1 p-1.5" style={{ background: canvas }}>
                <span className="h-1.5 w-3/4 rounded-full bg-stone-300/70" />
                <span className="h-2.5 w-1/2 rounded" style={{ background: primary }} />
              </span>
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-stone-900">{option.name}</span>
              <span className="block text-xs leading-4 text-stone-500">{option.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A small floating switcher, development only, to try themes anywhere in the app. */
export function ThemeQuickSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="fixed bottom-20 right-3 z-[60] flex items-center gap-1 rounded-full border border-stone-200 bg-white/95 p-1 shadow-lg backdrop-blur md:bottom-4">
      <span className="px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-stone-400">Tema</span>
      {THEMES.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setTheme(option.id)}
          title={option.name}
          aria-label={`Tema: ${option.name}`}
          aria-pressed={option.id === theme}
          className={`h-6 w-6 rounded-full ring-offset-2 transition ${option.id === theme ? "ring-2 ring-stone-900" : "hover:scale-110"}`}
          style={{ background: `linear-gradient(135deg, ${SWATCHES[option.id][0]} 50%, ${SWATCHES[option.id][1]} 50%)` }}
        />
      ))}
    </div>
  );
}

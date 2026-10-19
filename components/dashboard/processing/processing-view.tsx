"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

import { expectedConversionMs, recordConversionDuration } from "@/lib/conversion-durations";

import { DraftingAnimation } from "./drafting-animation";

/**
 * What the converter shows while the server draws: an animation beside the server's real
 * steps. The steps are read from the status messages the conversion stream sends.
 */

type ProcessingViewProps = {
  statusMessage?: string | null;
  /** The address or name the plan is being filed under, if one was given. */
  label?: string | null;
  /** The drawing shown while it works; the preview page swaps in the alternatives. */
  animation?: ReactNode;
  /** How long it usually takes. Defaults to what this device has measured; null for unknown. */
  expectedMs?: number | null;
};

/** Things that are true about the app, to read while waiting. */
const TIPS = [
  "Ge planritningen en adress, så hittar du den direkt i arkivet.",
  "Inte nöjd? Neka resultatet och beskriv vad som ska ändras, så tar nästa version hänsyn till det.",
  "Rumsnamn och inredning lägger du till i redigeraren efteråt.",
  "Kompassens riktning kan ändras i granskningen utan att ritningen genereras om.",
  "Hus med flera våningar laddar du ner som en samlad PDF från Planritningar.",
];
const TIP_MS = 6500;

/** Where the bar should stand at least, once the server has reached a step. */
const STEP_FLOOR = [0.03, 0.12, 0.86, 0.95];

/**
 * Fills towards ~90 % at the usual duration and slows as it gets there, never reaching the end
 * on its own; the server's steps push it forward when they arrive.
 */
function estimateProgress(elapsedMs: number, expectedMs: number, step: number) {
  const byTime = 0.95 * (1 - Math.exp((-2.3 * elapsedMs) / expectedMs));
  return Math.min(0.97, Math.max(byTime, STEP_FLOOR[step] ?? 0));
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 50) {
    return `${Math.max(5, Math.round(seconds / 5) * 5)} sekunder`;
  }
  const minutes = Math.round(seconds / 30) / 2;
  return `${String(minutes).replace(".", ",")} ${minutes === 1 ? "minut" : "minuter"}`;
}

/**
 * The server's own stages, in order, recognised from its status messages. Nothing here is
 * timed or guessed: a step is ticked off only when the server has moved past it.
 */
const PROCESSING_STEPS = [
  { title: "Läser in ritningen", match: /Förbereder/ },
  { title: "Ritar om linjerna", match: /Ritar om|Slutför/ },
  { title: "Lägger på ram och logotyp", match: /Sätter ram/ },
  { title: "Sparar planritningen", match: /Sparar/ },
] as const;

/** "Våning 1 (nedersta): Ritar om planritningen" → floor and message apart. */
function splitStatusMessage(message: string | null | undefined) {
  const match = message ? /^(Våning [^:]+): (.+)$/.exec(message) : null;
  return match ? { floor: match[1], message: match[2] } : { floor: null, message: message ?? "" };
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ProcessingView({ statusMessage, label, animation, expectedMs }: ProcessingViewProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [measuredExpectedMs] = useState(() =>
    typeof window === "undefined" ? null : expectedConversionMs(),
  );
  const usualMs = expectedMs === undefined ? measuredExpectedMs : expectedMs;
  const [tipIndex, setTipIndex] = useState(0);

  const { floor, message } = splitStatusMessage(statusMessage);
  const activeStep = PROCESSING_STEPS.reduce(
    (current, step, index) => (step.match.test(message) ? index : current),
    0,
  );
  const isRefining = /stilmallen/.test(message);

  // A single conversion that got as far as saving is a fair sample of how long one takes.
  // Several floors in one go are not, so those are left out.
  const reachedSavingRef = useRef(false);
  const sawFloorsRef = useRef(false);
  useEffect(() => {
    if (floor) sawFloorsRef.current = true;
    if (activeStep === PROCESSING_STEPS.length - 1) reachedSavingRef.current = true;
  }, [floor, activeStep]);

  useEffect(() => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    const tipId = window.setInterval(() => setTipIndex((index) => (index + 1) % TIPS.length), TIP_MS);

    return () => {
      window.clearInterval(intervalId);
      window.clearInterval(tipId);
      if (reachedSavingRef.current && !sawFloorsRef.current) {
        recordConversionDuration(Date.now() - startedAt);
      }
    };
  }, []);

  const progress = usualMs ? estimateProgress(elapsedMs, usualMs, activeStep) : null;
  const remainingMs = usualMs ? usualMs - elapsedMs : null;

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      className="relative grid overflow-hidden rounded-xl bg-stone-50 md:grid-cols-[minmax(0,1fr)_260px]"
    >
      <div className="relative flex min-h-[400px] items-center justify-center overflow-hidden px-6 py-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle,rgba(28,25,23,0.13)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute h-72 w-72 rounded-full bg-accent/15 blur-3xl"
        />
        <div className="relative">
          {animation ?? <DraftingAnimation />}
        </div>
      </div>

      <div className="relative flex flex-col justify-center border-t border-stone-200/70 bg-white px-6 py-7 md:border-l md:border-t-0">
        {label || floor ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {label ? (
              <span className="max-w-full truncate rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">
                {label}
              </span>
            ) : null}
            {floor ? (
              <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
                {floor}
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="text-lg font-semibold tracking-[-0.01em] text-stone-900">
          Ritar din planritning
        </p>
        <p className="mt-1 text-sm text-stone-500 tabular-nums">
          {usualMs === null || usualMs === undefined
            ? `Pågått i ${formatElapsed(Math.floor(elapsedMs / 1000))}`
            : remainingMs !== null && remainingMs > 4000
              ? `Ungefär ${formatDuration(remainingMs)} kvar`
              : "Strax klar, det tar ibland lite längre"}
        </p>

        <div
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-stone-100"
          role="progressbar"
          aria-label="Förlopp"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
        >
          {progress === null ? (
            <div className="sp-indeterminate h-full w-1/3 rounded-full bg-accent/70" />
          ) : (
            <div
              className="relative h-full overflow-hidden rounded-full bg-accent transition-[width] duration-700 ease-out"
              style={{ width: `${(progress * 100).toFixed(1)}%` }}
            >
              <div className="sp-progress-sheen absolute inset-0" />
            </div>
          )}
        </div>
        <style>{`
          @keyframes sp-indeterminate { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
          @keyframes sp-progress-sheen { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
          .sp-indeterminate { animation: sp-indeterminate 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite; }
          .sp-progress-sheen {
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent);
            animation: sp-progress-sheen 1.8s ease-in-out infinite;
          }
          @keyframes sp-tip { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
          .sp-tip { animation: sp-tip 0.5s ease-out both; }
          @media (prefers-reduced-motion: reduce) {
            .sp-indeterminate, .sp-progress-sheen, .sp-tip { animation: none; }
          }
        `}</style>

        <ol className="mt-6 space-y-3.5">
          {PROCESSING_STEPS.map((step, index) => {
            const state = index < activeStep ? "done" : index === activeStep ? "active" : "pending";
            return (
              <li key={step.title} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${
                    state === "done"
                      ? "bg-primary text-white"
                      : state === "active"
                        ? "bg-white ring-[1.5px] ring-accent"
                        : "bg-white ring-1 ring-stone-200"
                  }`}
                  aria-hidden="true"
                >
                  {state === "done" ? (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                      <path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : state === "active" ? (
                    <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                  ) : null}
                </span>
                <div className="min-w-0">
                  <p
                    className={`text-sm transition-colors duration-300 ${
                      state === "pending" ? "text-stone-400" : "font-medium text-stone-900"
                    }`}
                  >
                    {step.title}
                    <span className="sr-only">
                      {state === "done" ? " (klart)" : state === "active" ? " (pågår)" : ""}
                    </span>
                  </p>
                  {state === "active" && index === 1 && isRefining ? (
                    <p className="mt-0.5 text-xs text-stone-500">Finjusterar mot er stil</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-7 border-t border-stone-100 pt-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-stone-400">Tips</p>
          <p key={tipIndex} className="sp-tip mt-1.5 min-h-[3.75rem] text-sm leading-5 text-stone-600">
            {TIPS[tipIndex]}
          </p>
        </div>
      </div>
    </div>
  );
}

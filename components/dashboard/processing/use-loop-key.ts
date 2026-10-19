"use client";

import { useEffect, useState } from "react";

/** True when the visitor has asked for less motion; follows the setting live. */
export function useReducedMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduceMotion;
}

/**
 * A number that changes every `loopMs`. Used as the key of an animation's <svg>, so each loop
 * mounts it afresh and every timeline (CSS and SMIL alike) restarts from zero. Stays put when
 * motion is reduced, so the drawing is shown finished and still.
 */
export function useLoopKey(loopMs: number) {
  const [cycle, setCycle] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    const intervalId = window.setInterval(() => setCycle((previous) => previous + 1), loopMs);
    return () => window.clearInterval(intervalId);
  }, [loopMs, reduceMotion]);

  return cycle;
}

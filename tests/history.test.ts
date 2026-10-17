import { describe, expect, it } from "vitest";

import { canRedo, canUndo, createHistoryState, pushHistory, redoHistory, undoHistory } from "@/lib/floorplan/history";
import type { FloorplanDocument } from "@/lib/floorplan/types";

const plan = (objects: number) =>
  ({ version: 1, canvas: { width: 10, height: 10 }, meta: {}, objects: Array.from({ length: objects }, (_, i) => ({ id: String(i) })) }) as unknown as FloorplanDocument;

describe("undo and redo", () => {
  it("steps back and forward through edits, and a new edit drops the redo trail", () => {
    let state = createHistoryState(plan(0));
    state = pushHistory(state, plan(1));
    state = pushHistory(state, plan(2));
    expect(state.present.objects).toHaveLength(2);

    state = undoHistory(state);
    expect(state.present.objects).toHaveLength(1);
    expect(canRedo(state)).toBe(true);
    state = redoHistory(state);
    expect(state.present.objects).toHaveLength(2);

    state = undoHistory(undoHistory(state));
    expect(state.present.objects).toHaveLength(0);
    expect(canUndo(state)).toBe(false);
    expect(undoHistory(state)).toBe(state);

    state = pushHistory(state, plan(5));
    expect(canRedo(state)).toBe(false);
  });

  it("keeps the last 50 steps and copies documents, so later edits cannot change the past", () => {
    let state = createHistoryState(plan(0));
    for (let i = 1; i <= 60; i += 1) state = pushHistory(state, plan(i));
    expect(state.past).toHaveLength(50);

    const shared = plan(1);
    state = pushHistory(createHistoryState(plan(0)), shared);
    shared.objects.push({ id: "late" } as never);
    expect(state.present.objects).toHaveLength(1);
  });
});

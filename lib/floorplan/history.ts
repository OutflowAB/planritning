import { cloneDocument } from "@/lib/floorplan/document-factory";
import type { FloorplanDocument } from "@/lib/floorplan/types";

const MAX_HISTORY_ENTRIES = 50;

export type FloorplanHistoryState = {
  past: FloorplanDocument[];
  present: FloorplanDocument;
  future: FloorplanDocument[];
};

export function createHistoryState(document: FloorplanDocument): FloorplanHistoryState {
  return {
    past: [],
    present: cloneDocument(document),
    future: [],
  };
}

export function pushHistory(state: FloorplanHistoryState, nextDocument: FloorplanDocument): FloorplanHistoryState {
  const snapshot = cloneDocument(state.present);
  const past = [...state.past, snapshot].slice(-MAX_HISTORY_ENTRIES);

  return {
    past,
    present: cloneDocument(nextDocument),
    future: [],
  };
}

export function undoHistory(state: FloorplanHistoryState): FloorplanHistoryState {
  if (state.past.length === 0) {
    return state;
  }

  const previous = state.past[state.past.length - 1];
  const past = state.past.slice(0, -1);
  const future = [cloneDocument(state.present), ...state.future].slice(0, MAX_HISTORY_ENTRIES);

  return {
    past,
    present: cloneDocument(previous),
    future,
  };
}

export function redoHistory(state: FloorplanHistoryState): FloorplanHistoryState {
  if (state.future.length === 0) {
    return state;
  }

  const [next, ...future] = state.future;
  const past = [...state.past, cloneDocument(state.present)].slice(-MAX_HISTORY_ENTRIES);

  return {
    past,
    present: cloneDocument(next),
    future,
  };
}

export function canUndo(state: FloorplanHistoryState) {
  return state.past.length > 0;
}

export function canRedo(state: FloorplanHistoryState) {
  return state.future.length > 0;
}

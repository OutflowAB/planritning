import type { ConvertDoneEvent } from "@/lib/floorplan/convert-stream";

/** Where a drawn floor stands in the broker's review. */
export type FloorStatus = "pending" | "approved" | "redone";

export type StoreyFloor = {
  label: string;
  conversion: ConvertDoneEvent;
  status: FloorStatus;
};

/** The line under the progress bar: the floor being drawn now, then "Alla våningar klara". */
export function storeyProgressText(done: number, total: number) {
  return done >= total ? "Alla våningar klara" : `Ritar våning ${done + 1} av ${total}…`;
}

/** The next floor still waiting for a decision, looking forward from `from` and then wrapping. */
export function nextPendingFloor(floors: StoreyFloor[], from: number) {
  for (let step = 1; step <= floors.length; step += 1) {
    const index = (from + step) % floors.length;
    if (floors[index]?.status !== "approved") {
      return index;
    }
  }
  return -1;
}

export function markFloor(floors: StoreyFloor[], index: number, status: FloorStatus) {
  return floors.map((floor, i) => (i === index ? { ...floor, status } : floor));
}

/** A re-converted floor takes the place of the old one and is flagged as redone. */
export function replaceFloor(floors: StoreyFloor[], index: number, conversion: ConvertDoneEvent) {
  return floors.map((floor, i) => (i === index ? { ...floor, conversion, status: "redone" as const } : floor));
}

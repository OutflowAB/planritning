import {
  buildCompareBefore,
  composeBrandedFloorplan,
  prepareSourceImage,
  type CompareSlotLayout,
} from "@/lib/image/brand-floorplan";

/**
 * Rebuilds the "before" half of the comparison for an already generated result.
 *
 * With a slot — the geometry the result was composed with — the whole original is fitted into
 * that slot, which is the only way it can line up with an AI drawing that placed the plan
 * wherever it liked. Without one this falls back to composing the original itself, which is
 * what the algorithm path does and is byte-for-byte what this file used to compute with its
 * own copy of the layout maths.
 */
export async function buildCompareBeforeImage(inputBuffer: Buffer, slot?: CompareSlotLayout) {
  const orientedColorBuffer = await prepareSourceImage(inputBuffer);

  if (slot) {
    return buildCompareBefore(orientedColorBuffer, slot, { cropToDrawing: false });
  }

  const branded = await composeBrandedFloorplan(orientedColorBuffer);
  return buildCompareBefore(orientedColorBuffer, branded);
}

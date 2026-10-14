import { describe, expect, it } from "vitest";

import type { ConvertDoneEvent } from "@/lib/floorplan/convert-stream";
import {
  markFloor,
  nextPendingFloor,
  replaceFloor,
  savedImageVersion,
  updateFloorImage,
  storeyProgressText,
  type StoreyFloor,
} from "@/lib/storey-floors";

const conversion = (id: number) => ({ savedImageId: id }) as ConvertDoneEvent;
const floors = (): StoreyFloor[] =>
  [1, 2, 3].map((id) => ({ label: `Våning ${id}`, conversion: conversion(id), status: "pending" }));

describe("storeyProgressText", () => {
  it("names the floor being drawn, one-based", () => {
    expect(storeyProgressText(0, 4)).toBe("Ritar våning 1 av 4…");
    expect(storeyProgressText(3, 4)).toBe("Ritar våning 4 av 4…");
  });

  it("says everything is done at the end", () => {
    expect(storeyProgressText(4, 4)).toBe("Alla våningar klara");
  });
});

describe("floor review state", () => {
  it("moves to the next floor that is not approved, wrapping around", () => {
    let list = markFloor(floors(), 2, "approved");
    expect(nextPendingFloor(list, 1)).toBe(0);
    list = markFloor(list, 0, "approved");
    expect(nextPendingFloor(list, 1)).toBe(1);
  });

  it("returns -1 once every floor is approved", () => {
    const list = floors().map((floor) => ({ ...floor, status: "approved" as const }));
    expect(nextPendingFloor(list, 0)).toBe(-1);
  });

  it("lets a redone floor count as still open and swaps in the new result", () => {
    const list = replaceFloor(floors(), 1, conversion(9));
    expect(list[1]).toMatchObject({ status: "redone", conversion: { savedImageId: 9 } });
    expect(nextPendingFloor(list, 0)).toBe(1);
  });
});

describe("re-composed floors", () => {
  it("reads the version out of a saved image URL", () => {
    expect(savedImageVersion("/api/image?id=3&variant=full&v=abc123")).toBe("abc123");
    expect(savedImageVersion("/api/image?id=3&variant=full")).toBeNull();
    expect(savedImageVersion(null)).toBeNull();
  });

  it("gives only the matching floor its new picture", () => {
    const updated = updateFloorImage(floors(), 2, "/api/image?id=2&variant=full&v=9");
    expect(updated.map((floor) => floor.conversion.savedImageUrl)).toEqual([
      undefined,
      "/api/image?id=2&variant=full&v=9",
      undefined,
    ]);
    expect(updated[1].status).toBe("pending");
  });
});

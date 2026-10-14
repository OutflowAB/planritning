import { describe, expect, it } from "vitest";

import {
  floorGroupSuffix,
  floorLabel,
  groupLibraryItems,
  newFloorRun,
  parseFloorGroup,
  parseFloorGroupInput,
} from "@/lib/floor-groups";
import { imageDownloadFileName } from "@/lib/image-naming";

const RUN = "0123456789ab";
const path = (suffix: string) => `generated/1791000000000-5f3c2b1a-1111-4222-8333-444455556666${suffix}.png`;

describe("floor group names", () => {
  it("round-trips through the stored path", () => {
    const group = { run: RUN, position: 2, total: 4 };
    expect(parseFloorGroup(path(floorGroupSuffix(group)))).toEqual(group);
  });

  it("leaves plain plans alone", () => {
    expect(floorGroupSuffix(null)).toBe("");
    expect(parseFloorGroup(path(""))).toBeNull();
    expect(parseFloorGroup("uploads/polycam-1791-abc.png")).toBeNull();
    expect(parseFloorGroup(null)).toBeNull();
  });

  it("rejects malformed or impossible groups", () => {
    expect(floorGroupSuffix({ run: "short", position: 0, total: 2 })).toBe("");
    expect(floorGroupSuffix({ run: RUN, position: 3, total: 3 })).toBe("");
    expect(floorGroupSuffix({ run: RUN, position: 0, total: 1 })).toBe("");
    expect(parseFloorGroup(path("-gZZZZZZZZZZZZ-f0-n2"))).toBeNull();
    expect(parseFloorGroupInput({ run: RUN, position: -1, total: 3 })).toBeNull();
    expect(parseFloorGroupInput({ run: RUN, position: "1", total: 3 })).toBeNull();
    expect(parseFloorGroupInput("x")).toBeNull();
    expect(parseFloorGroupInput({ run: "../../etc/pass", position: 0, total: 2 })).toBeNull();
    expect(parseFloorGroupInput({ run: RUN, position: 1, total: 3 })).toEqual({ run: RUN, position: 1, total: 3 });
  });

  it("makes runs that satisfy the pattern", () => {
    expect(newFloorRun()).toMatch(/^[0-9a-f]{12}$/);
    expect(newFloorRun()).not.toBe(newFloorRun());
  });

  it("labels floors by position", () => {
    expect(floorLabel(0, 3)).toBe("Våning 1 (nedersta)");
    expect(floorLabel(1, 3)).toBe("Våning 2");
    expect(floorLabel(2, 3)).toBe("Våning 3 (översta)");
  });

  it("keeps the thumbnail and download names derivable", () => {
    expect(imageDownloadFileName(5, "png")).toBe("bild-5.png");
  });
});

describe("groupLibraryItems", () => {
  const item = (id: number, suffix = "", name = `${id}`) => ({
    id,
    file_path: `generated/${name}-uuid${suffix}.png`,
  });
  const group = (run: string, position: number, total = 3) => floorGroupSuffix({ run, position, total });

  it("folds the floors of one house into one entry, lowest first", () => {
    const items = [
      item(9, group(RUN, 2)),
      item(8),
      item(7, group(RUN, 0)),
      item(6, group(RUN, 1)),
      item(5),
    ];
    const entries = groupLibraryItems(items);
    expect(entries.map((entry) => entry.kind)).toEqual(["group", "single", "single"]);
    const first = entries[0];
    expect(first.kind === "group" && first.floors.map((floor) => floor.item.id)).toEqual([7, 6, 9]);
    expect(first.kind === "group" && first.run).toBe(RUN);
  });

  it("puts the house where its newest floor stood and keeps other plans in order", () => {
    const entries = groupLibraryItems([item(10), item(9, group(RUN, 1)), item(8), item(7, group(RUN, 0))]);
    expect(entries.map((entry) => (entry.kind === "single" ? entry.item.id : "house"))).toEqual([10, "house", 8]);
  });

  it("keeps separate houses apart", () => {
    const other = "ba9876543210";
    const entries = groupLibraryItems([
      item(4, group(RUN, 0, 2)),
      item(3, group(other, 0, 2)),
      item(2, group(RUN, 1, 2)),
      item(1, group(other, 1, 2)),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(["group", "group"]);
  });

  it("shows a lone floor of a house as a plain card", () => {
    const entries = groupLibraryItems([item(2, group(RUN, 1)), item(1)]);
    expect(entries.map((entry) => entry.kind)).toEqual(["single", "single"]);
  });

  it("changes nothing for a library without houses", () => {
    const items = [item(3), item(2), item(1)];
    expect(groupLibraryItems(items).map((entry) => entry.kind === "single" && entry.item)).toEqual(items);
  });
});

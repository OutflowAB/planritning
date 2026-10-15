import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  chooseDoorSwings,
  sectorFor,
  sectorHitsPolygon,
  sectorsOverlap,
  type SwingDoor,
} from "@/lib/polycam/door-swing";
import { parseRoomplan } from "@/lib/polycam/parse-roomplan";
import { preparePlan, wallOutline } from "@/lib/polycam/render-plan";

const along = { x: 1, z: 0 };
const rect = (x0: number, z0: number, x1: number, z1: number) => [
  { x: x0, z: z0 },
  { x: x1, z: z0 },
  { x: x1, z: z1 },
  { x: x0, z: z1 },
];

describe("sector geometry", () => {
  const sector = sectorFor({ centre: { x: 0, z: 0 }, along, length: 1 }, -1, 1);

  it("hits a wall inside the swept quarter disc and not one outside it", () => {
    // hinge (-0.5, 0), sweeps towards +x and +z
    expect(sectorHitsPolygon(sector, rect(-0.2, 0.3, 0.2, 0.4))).toBe(true);
    expect(sectorHitsPolygon(sector, rect(-0.2, -0.4, 0.2, -0.3))).toBe(false);
    expect(sectorHitsPolygon(sector, rect(-0.2, 1.2, 0.2, 1.3))).toBe(false);
  });

  it("lets a wall touch the sector edge without counting it as a hit", () => {
    expect(sectorHitsPolygon(sector, rect(-2, -0.2, 2, 0))).toBe(false);
  });

  it("detects overlapping and disjoint sectors", () => {
    const same = sectorFor({ centre: { x: 0, z: 0 }, along, length: 1 }, -1, 1);
    const mirrored = sectorFor({ centre: { x: 0, z: 0 }, along, length: 1 }, -1, -1);
    expect(sectorsOverlap(sector, same)).toBe(true);
    expect(sectorsOverlap(sector, mirrored)).toBe(false);
  });
});

describe("chooseDoorSwings", () => {
  const door = (x: number, hint: SwingDoor["hint"] = null): SwingDoor => ({
    centre: { x, z: 0 },
    along,
    length: 0.8,
    parentWallId: "w",
    hint,
  });
  const parent = { id: "w", outline: rect(-5, -0.1, 5, 0.1) };

  it("swings into free floor when the hint points into a wall", () => {
    // A wall 0.5 m below the door: the -z side is blocked whatever the hint says.
    const blocker = { id: "b", outline: rect(-5, -0.6, 5, -0.5) };
    const [choice] = chooseDoorSwings([door(0, "left_p2")], [parent, blocker], []);
    expect(choice?.faceSign).toBe(1);
  });

  it("keeps two facing doors in a corridor from overlapping", () => {
    const choices = chooseDoorSwings([door(0), door(0.5)], [parent], []);
    const placed = choices.filter((c) => c !== null);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(sectorsOverlap(placed[i]!.sector, placed[j]!.sector)).toBe(false);
      }
    }
  });

  it("draws only the gap when every candidate is blocked", () => {
    const box = [
      { id: "n", outline: rect(-5, 0.3, 5, 0.4) },
      { id: "s", outline: rect(-5, -0.4, 5, -0.3) },
    ];
    expect(chooseDoorSwings([door(0)], [parent, ...box], [])).toEqual([null]);
  });

  it("uses the hint only as a tie-breaker and is deterministic", () => {
    const a = chooseDoorSwings([door(0, "right_p2")], [parent], []);
    const b = chooseDoorSwings([door(0, "right_p2")], [parent], []);
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({ hingeSign: 1, faceSign: -1 });
  });
});

describe("sample scan", () => {
  const model = parseRoomplan(
    JSON.parse(readFileSync("tests/fixtures/polycam/sample-optimized-roomplan.json", "utf8")),
  );
  const plan = preparePlan(model);
  const doors = plan.openings.filter((opening) => opening.kind === "door");

  it("no door arc crosses another wall or another arc", () => {
    const sectors = doors.flatMap((d) => (d.swing ? [{ d, sector: d.swing.sector }] : []));
    for (const { d, sector } of sectors) {
      for (const wall of plan.walls) {
        if (wall.id === d.parentWallId) continue;
        expect(sectorHitsPolygon(sector, wallOutline(wall)), `door in wall ${d.parentWallId} vs wall ${wall.id}`).toBe(false);
      }
    }
    for (let i = 0; i < sectors.length; i += 1) {
      for (let j = i + 1; j < sectors.length; j += 1) {
        expect(sectorsOverlap(sectors[i].sector, sectors[j].sector)).toBe(false);
      }
    }
  });

  it("the check catches the old behaviour (hint, default left_p1)", () => {
    // Same check applied to the legacy choice; proves the regression test above has teeth.
    const legacy = doors.map((d) => {
      const hint = d.swingHint ?? "left_p1";
      return sectorFor(d, hint.startsWith("left") ? -1 : 1, hint.endsWith("p2") ? -1 : 1);
    });
    const wallHit = doors.some((d, i) =>
      plan.walls.some((w) => w.id !== d.parentWallId && sectorHitsPolygon(legacy[i], wallOutline(w))),
    );
    const doorHit = legacy.some((s, i) => legacy.some((t, j) => j > i && sectorsOverlap(s, t)));
    expect(wallHit || doorHit).toBe(true);
  });
});

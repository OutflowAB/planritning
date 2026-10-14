import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PolycamError } from "@/lib/polycam/fetch-roomplan";
import { MAX_ELEMENTS, parseRoomplan } from "@/lib/polycam/parse-roomplan";

const SAMPLE_PATH = path.resolve(__dirname, "fixtures/polycam/sample-optimized-roomplan.json");
const sample = () => JSON.parse(readFileSync(SAMPLE_PATH, "utf8")) as Record<string, unknown>;

function wall(overrides: Record<string, unknown> = {}) {
  return {
    identifier: "w1",
    wall_thickness: 0.1,
    dimensions: [3, 2.4, 0],
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 2, 1],
    story: 0,
    ...overrides,
  };
}

function expectInvalid(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PolycamError);
    expect((error as PolycamError).code).toBe("invalid");
    expect((error as Error).message).toBe("Planritningen från Polycam kunde inte läsas.");
    return;
  }
  throw new Error("expected the file to be rejected");
}

describe("parseRoomplan", () => {
  it("reads the real sample capture", () => {
    const model = parseRoomplan(sample());
    expect(model.walls).toHaveLength(25);
    expect(model.openings.filter((item) => item.kind === "door")).toHaveLength(5);
    expect(model.openings.filter((item) => item.kind === "window")).toHaveLength(4);
    expect(model.openings.filter((item) => item.kind === "opening")).toHaveLength(2);
    expect(model.rooms).toHaveLength(8);
    expect(model.skipped).toBe(0);
    expect(model.alignment).not.toBeNull();
    expect(model.orientationDegrees).toBeCloseTo(51.37, 1);

    const doors = model.openings.filter((item) => item.kind === "door");
    expect(doors.filter((door) => door.swing === null)).toHaveLength(2);
    expect(doors.every((door) => door.parentWallId !== null)).toBe(true);

    for (const element of [...model.walls, ...model.openings]) {
      expect(Math.hypot(element.along.x, element.along.z)).toBeCloseTo(1, 6);
    }
  });

  it("keeps nothing but the plan: no GPS, labels, furniture or raw fields", () => {
    const data = sample();
    data.latLonAlt = { latitude: 59.123456, longitude: 18.654321, altitude: 12.345678 };
    const keys = new Set<string>();
    const numbers: number[] = [];
    JSON.stringify(parseRoomplan(data), (key, value) => {
      if (key && Number.isNaN(Number(key))) keys.add(key);
      if (typeof value === "number") numbers.push(value);
      return value;
    });

    expect([...keys].sort()).toEqual(
      [
        "alignment", "along", "centre", "height", "id", "kind", "length", "openings",
        "orientationDegrees", "parentWallId", "rooms", "skipped", "story", "swing", "t00",
        "t02", "t03", "t20", "t22", "t23", "thickness", "vertices", "walls", "x", "z",
      ].sort(),
    );
    expect(numbers).not.toContain(59.123456);
    expect(numbers).not.toContain(18.654321);
    expect(numbers).not.toContain(12.345678);
  });

  it("tolerates missing optional parts", () => {
    const model = parseRoomplan({ walls: [wall({ wall_thickness: undefined, story: undefined, identifier: undefined })] });
    expect(model.walls[0]).toMatchObject({ thickness: 0.1, story: 0, id: null, length: 3 });
    expect(model.openings).toEqual([]);
    expect(model.rooms).toEqual([]);
    expect(model.alignment).toBeNull();
    expect(model.orientationDegrees).toBeNull();
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "walls"],
    ["no walls", { doors: [] }],
    ["walls that are not a list", { walls: { 0: wall() } }],
    ["doors that are not a list", { walls: [wall()], doors: "x" }],
    ["too many walls", { walls: Array.from({ length: MAX_ELEMENTS + 1 }, () => wall()) }],
    ["too many windows", { walls: [], windows: Array.from({ length: MAX_ELEMENTS + 1 }, () => wall()) }],
  ])("rejects %s", (_label, data) => {
    expectInvalid(() => parseRoomplan(data));
  });

  it.each([
    ["an Infinity coordinate", { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Infinity, 0, 0, 1] }],
    ["a NaN coordinate", { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Number.NaN, 0, 0, 1] }],
    ["a string in the transform", { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, "1", 0, 0, 1] }],
    ["a short transform", { transform: [1, 0, 0] }],
    ["a far-away wall", { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5000, 0, 0, 1] }],
    ["a zero direction", { transform: [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1] }],
    ["a negative length", { dimensions: [-1, 2.4, 0] }],
    ["a giant length", { dimensions: [1e9, 2.4, 0] }],
    ["missing dimensions", { dimensions: undefined }],
  ])("drops a wall with %s and counts it", (_label, overrides) => {
    const model = parseRoomplan({ walls: [wall(), wall(overrides)] });
    expect(model.walls).toHaveLength(1);
    expect(model.skipped).toBe(1);
  });

  it("ignores an alignment that would stretch the plan", () => {
    const stretched = { t00: 2, t02: 0, t03: 0, t20: 0, t22: 2, t23: 0 };
    expect(parseRoomplan({ walls: [wall()], alignment_transform: stretched }).alignment).toBeNull();
  });

  it("reads an unknown door swing as unknown", () => {
    const model = parseRoomplan({ walls: [], doors: [wall({ door_swing_dir: "sideways" })] });
    expect(model.openings[0]).toMatchObject({ kind: "door", swing: null, parentWallId: null });
  });

  it("drops room polygons that are malformed", () => {
    const model = parseRoomplan({
      walls: [wall()],
      rooms: [
        { vertices_x: [0, 1, 1], vertices_z: [0, 0, 1], story: 0 },
        { vertices_x: [0, 1], vertices_z: [0, 0] },
        { vertices_x: [0, 1, 1], vertices_z: [0, 0] },
        { vertices_x: [0, 1, Infinity], vertices_z: [0, 0, 1] },
      ],
    });
    expect(model.rooms).toHaveLength(1);
    expect(model.skipped).toBe(3);
  });
});

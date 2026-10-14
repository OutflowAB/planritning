import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { PolycamError } from "@/lib/polycam/fetch-roomplan";
import { parseRoomplan } from "@/lib/polycam/parse-roomplan";
import { PLAN_LONG_EDGE_PX, renderPlan } from "@/lib/polycam/render-plan";

const SAMPLE_PATH = path.resolve(__dirname, "fixtures/polycam/sample-optimized-roomplan.json");

type Point = [number, number];

/** Rotates a plan-plane point by `degrees`, the way a scan started at an angle would. */
function rotate([x, z]: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  return [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
}

/** A RoomPlan element between two points given in the straightened frame. */
function element(from: Point, to: Point, { degrees = 0, height = 2.4, story = 0, id = "w", extra = {} } = {}) {
  const [ax, az] = rotate([to[0] - from[0], to[1] - from[1]], degrees);
  const length = Math.hypot(ax, az);
  const [cx, cz] = rotate([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], degrees);
  return {
    identifier: id,
    wall_thickness: 0.1,
    dimensions: [length, height, 0],
    transform: [ax / length, 0, az / length, 0, 0, 1, 0, 0, -az / length, 0, ax / length, 0, cx, 0, cz, 1],
    story,
    ...extra,
  };
}

/** The alignment RoomPlan would report for a scan rotated by `degrees`: it undoes it. */
function alignmentFor(degrees: number) {
  const a = (-degrees * Math.PI) / 180;
  return { t00: Math.cos(a), t02: -Math.sin(a), t03: 0, t20: Math.sin(a), t22: Math.cos(a), t23: 0 };
}

/** A 4 x 3 m room, optionally rotated, as a raw RoomPlan file. */
function box({ degrees = 0, story = 0, size = [4, 3] as Point, skip = [] as number[] } = {}) {
  const [w, h] = size;
  const corners: Point[] = [[0, 0], [w, 0], [w, h], [0, h]];
  return [0, 1, 2, 3]
    .filter((index) => !skip.includes(index))
    .map((index) =>
      element(corners[index], corners[(index + 1) % 4], { degrees, story, id: `${story}-${index}` }),
    );
}

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const offset = (Math.round(y) * info.width + Math.round(x)) * info.channels;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  let black = 0;
  let white = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const value = data[offset];
    if (value < 64) black += 1;
    else if (value > 240) white += 1;
  }
  const total = info.width * info.height;
  return { info, at, blackRatio: black / total, whiteRatio: white / total };
}

describe("renderPlan on the sample capture", () => {
  it("draws a straightened, flattened plan at the working width", async () => {
    const model = parseRoomplan(JSON.parse(readFileSync(SAMPLE_PATH, "utf8")));
    const plan = await renderPlan(model);
    const metadata = await sharp(plan.png).metadata();

    expect(Math.max(plan.width, plan.height)).toBe(PLAN_LONG_EDGE_PX);
    expect(metadata.width).toBe(plan.width);
    expect(metadata.height).toBe(plan.height);
    expect(metadata.hasAlpha).toBe(false);
    // The apartment is long and narrow, so the plan is portrait.
    expect(plan.height).toBeGreaterThan(plan.width * 1.5);

    expect(plan.story).toBe(0);
    expect(plan.storyCount).toBe(1);
    // 25 walls, minus the 0.20 m stub.
    expect(plan.droppedShortWalls).toBe(1);
    expect(plan.wallCount).toBe(24);
    expect(plan.exteriorWallCount).toBeGreaterThanOrEqual(8);
    expect(plan.exteriorWallCount).toBeLessThan(plan.wallCount);

    const { blackRatio, whiteRatio } = await pixels(plan.png);
    expect(whiteRatio).toBeGreaterThan(0.85);
    expect(blackRatio).toBeGreaterThan(0.02);
    expect(blackRatio).toBeLessThan(0.12);
  });
});

describe("renderPlan on synthetic scans", () => {
  it("straightens a rotated room using the alignment", async () => {
    const straight = await renderPlan(parseRoomplan({ walls: box() }));
    const rotated = await renderPlan(
      parseRoomplan({ walls: box({ degrees: 23 }), alignment_transform: alignmentFor(23) }),
    );

    // Both are a 4.1 x 3.1 m box (walls plus end caps) at the same scale.
    expect(rotated.width).toBe(PLAN_LONG_EDGE_PX);
    expect(Math.abs(rotated.height - straight.height)).toBeLessThanOrEqual(1);
    const margin = Math.round(PLAN_LONG_EDGE_PX * 0.06);
    expect(rotated.height - 2 * margin).toBeCloseTo(((PLAN_LONG_EDGE_PX - 2 * margin) * 3.1) / 4.1, -1);

    // Without the alignment it stays tilted and its bounding box is far squarer.
    const tilted = await renderPlan(parseRoomplan({ walls: box({ degrees: 23 }) }));
    expect(tilted.height / tilted.width).toBeGreaterThan(rotated.height / rotated.width + 0.1);
  });

  it("cuts a door into its wall and draws a window as a white inset", async () => {
    const walls = box({ degrees: 15 });
    const plan = await renderPlan(
      parseRoomplan({
        walls,
        alignment_transform: alignmentFor(15),
        doors: [element([1.6, 3], [2.4, 3], { degrees: 15, extra: { parentIdentifier: "0-2", door_swing_dir: "left_p1" } })],
        windows: [element([1.5, 0], [2.5, 0], { degrees: 15, extra: { parentIdentifier: "0-0" } })],
      }),
    );

    // The door's swing can reach outside the box, so locate the walls from the pixels.
    const { at, info } = await pixels(plan.png);
    const column = Array.from({ length: info.height }, (_, y) => at(Math.round(info.width * 0.15), y)[0]);
    const firstBlack = column.findIndex((value) => value < 64);
    const lastBlack = column.length - 1 - [...column].reverse().findIndex((value) => value < 64);
    const scale = (lastBlack - firstBlack) / 3.1;
    const centreX = info.width / 2;
    const bottomWallY = lastBlack - 0.05 * scale;
    const topWallY = firstBlack + 0.05 * scale;

    expect(at(centreX - 1.6 * scale, topWallY)[0]).toBeLessThan(64); // solid wall beside the window
    expect(at(centreX, topWallY)[0]).toBeGreaterThan(240); // window inset is white
    expect(at(centreX - 1.6 * scale, bottomWallY)[0]).toBeLessThan(64); // solid wall beside the door
    expect(at(centreX, bottomWallY)[0]).toBeGreaterThan(240); // door gap
  });

  it("still draws a scan with walls missing", async () => {
    const plan = await renderPlan(parseRoomplan({ walls: box({ skip: [1, 3] }) }));
    expect(plan.wallCount).toBe(2);
    expect(plan.width).toBe(PLAN_LONG_EDGE_PX);
  });

  it("rejects a scan with no walls in Swedish", async () => {
    for (const data of [{ walls: [] }, { walls: [element([0, 0], [0.2, 0])] }]) {
      await expect(renderPlan(parseRoomplan(data))).rejects.toThrow(
        new PolycamError("missing", "Skanningen innehåller inga väggar som går att rita."),
      );
    }
  });

  it("draws only the lowest story of a multi-storey scan and reports the count", async () => {
    const plan = await renderPlan(
      parseRoomplan({ walls: [...box({ story: 1, size: [8, 2] }), ...box({ story: 2 })] }),
    );
    const single = await renderPlan(parseRoomplan({ walls: box({ size: [8, 2] }) }));
    expect(plan.story).toBe(1);
    expect(plan.storyCount).toBe(2);
    expect(plan.wallCount).toBe(4);
    expect([plan.width, plan.height]).toEqual([single.width, single.height]);
  });

  it("thickens walls that have a room on one side only", async () => {
    const rooms = [{ vertices_x: [0, 4, 4, 0], vertices_z: [0, 0, 3, 3], story: 0 }];
    const partition = element([2, 0], [2, 3], { id: "inner" });
    const withRooms = await renderPlan(parseRoomplan({ walls: [...box(), partition], rooms }));
    const withoutRooms = await renderPlan(parseRoomplan({ walls: [...box(), partition] }));

    expect(withRooms.exteriorWallCount).toBe(4);
    expect(withoutRooms.exteriorWallCount).toBe(0);
    // Grown outwards: the outline gets bigger, the corners stay closed.
    expect(withRooms.height).toBeGreaterThan(withoutRooms.height);
    const { at } = await pixels(withRooms.png);
    const margin = Math.round(PLAN_LONG_EDGE_PX * 0.06);
    expect(at(margin + 2, margin + 2)[0]).toBeLessThan(64);
  });

  it("draws a low railing thinner than a wall instead of dropping it", async () => {
    const railing = element([0, 3], [4, 3], { height: 0.9 });
    const withRailing = await renderPlan(parseRoomplan({ walls: [...box({ skip: [2] }), railing] }));
    const withWall = await renderPlan(parseRoomplan({ walls: box() }));
    expect(withRailing.wallCount).toBe(4);
    const railingInk = (await pixels(withRailing.png)).blackRatio;
    const wallInk = (await pixels(withWall.png)).blackRatio;
    expect(railingInk).toBeLessThan(wallInk * 0.9);
    expect(railingInk).toBeGreaterThan(wallInk * 0.6);
  });
});

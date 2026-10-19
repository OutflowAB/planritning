import { describe, expect, it } from "vitest";

import { alignBoxes, alignmentToCss, findWallBox, toFractions, type GreyImage } from "@/lib/compare-alignment";

function blank(width: number, height: number, paper = 235): GreyImage {
  return { data: new Uint8ClampedArray(width * height).fill(paper), width, height };
}

function rect(image: GreyImage, x: number, y: number, w: number, h: number, ink = 20) {
  for (let row = y; row < y + h; row += 1) {
    for (let col = x; col < x + w; col += 1) {
      image.data[row * image.width + col] = ink;
    }
  }
}

/** A plan outline with 3 px walls, plus an inner wall. */
function drawPlan(image: GreyImage, x: number, y: number, w: number, h: number) {
  rect(image, x, y, w, 3);
  rect(image, x, y + h - 3, w, 3);
  rect(image, x, y, 3, h);
  rect(image, x + w - 3, y, 3, h);
  rect(image, x + Math.round(w / 2), y, 3, Math.round(h * 0.6));
}

/** Short dark marks, like lettering: should not count as walls. */
function drawText(image: GreyImage, x: number, y: number) {
  for (let letter = 0; letter < 12; letter += 1) {
    rect(image, x + letter * 6, y, 3, 5);
  }
}

describe("findWallBox", () => {
  it("finds the walls and ignores lettering outside them", () => {
    const image = blank(400, 500);
    drawPlan(image, 80, 120, 200, 260);
    drawText(image, 20, 30);
    drawText(image, 250, 450);

    expect(findWallBox(image)).toEqual({ x: 80, y: 120, width: 200, height: 260 });
  });

  it("works on coloured paper, not just white", () => {
    const image = blank(300, 300, 200);
    drawPlan(image, 50, 60, 180, 150);

    expect(findWallBox(image)).toEqual({ x: 50, y: 60, width: 180, height: 150 });
  });

  it("stays inside the region it is given", () => {
    const image = blank(400, 500);
    // A sheet frame around everything, which must not be read as a wall.
    rect(image, 5, 5, 390, 2);
    rect(image, 5, 493, 390, 2);
    rect(image, 5, 5, 2, 490);
    rect(image, 393, 5, 2, 490);
    drawPlan(image, 100, 150, 200, 200);

    expect(findWallBox(image, { x: 40, y: 60, width: 320, height: 380 })).toEqual({
      x: 100,
      y: 150,
      width: 200,
      height: 200,
    });
  });

  it("returns null for an empty page or one with only lettering", () => {
    expect(findWallBox(blank(200, 200))).toBeNull();
    const lettered = blank(200, 200);
    drawText(lettered, 20, 20);
    expect(findWallBox(lettered)).toBeNull();
  });
});

describe("alignBoxes", () => {
  it("maps the original's walls exactly onto the new walls", () => {
    const before = blank(400, 400);
    const after = blank(400, 400);
    drawPlan(before, 120, 140, 160, 120); // small, off-centre, wide
    drawPlan(after, 60, 50, 280, 300); // large, taller proportions

    const beforeBox = toFractions(findWallBox(before)!, before);
    const afterBox = toFractions(findWallBox(after)!, after);
    const alignment = alignBoxes(beforeBox, afterBox)!;

    // The original's corners land on the new corners.
    expect(beforeBox.x * alignment.scaleX + alignment.translateX).toBeCloseTo(afterBox.x);
    expect(beforeBox.y * alignment.scaleY + alignment.translateY).toBeCloseTo(afterBox.y);
    expect((beforeBox.x + beforeBox.width) * alignment.scaleX + alignment.translateX).toBeCloseTo(
      afterBox.x + afterBox.width,
    );
    expect((beforeBox.y + beforeBox.height) * alignment.scaleY + alignment.translateY).toBeCloseTo(
      afterBox.y + afterBox.height,
    );
  });

  it("refuses a stretch so large it cannot be the same plan", () => {
    expect(alignBoxes({ x: 0, y: 0, width: 0.05, height: 0.5 }, { x: 0, y: 0, width: 0.9, height: 0.5 })).toBeNull();
  });

  it("renders as a translate-then-scale CSS transform", () => {
    expect(alignmentToCss({ scaleX: 2, scaleY: 1.5, translateX: -0.25, translateY: 0.1 })).toBe(
      "translate(-25.000%, 10.000%) scale(2.0000, 1.5000)",
    );
  });
});

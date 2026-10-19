import { describe, expect, it } from "vitest";

import { runLimited } from "@/lib/run-limited";

describe("runLimited", () => {
  it("keeps to the limit, keeps the order of results and lets failures stand alone", async () => {
    let concurrent = 0;
    let peak = 0;
    const results = await runLimited([1, 2, 3, 4, 5, 6], 3, async (n) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      if (n === 4) throw new Error("fel");
      return n * 2;
    });
    expect(peak).toBe(3);
    expect(results.map((result) => (result.status === "fulfilled" ? result.value : "fel"))).toEqual([2, 4, 6, "fel", 10, 12]);
  });
});

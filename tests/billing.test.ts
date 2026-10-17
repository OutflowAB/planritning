import { describe, expect, it } from "vitest";

import { planPriceOre, stockholmRange } from "@/lib/billing";

describe("planPriceOre", () => {
  it("reads the price in kronor, defaulting to 50", () => {
    expect(planPriceOre(undefined)).toBe(5000);
    expect(planPriceOre("75")).toBe(7500);
    expect(planPriceOre("49.5")).toBe(4950);
    expect(planPriceOre("nonsense")).toBe(5000);
    expect(planPriceOre("-1")).toBe(5000);
  });
});

describe("stockholmRange", () => {
  it("starts a month at Stockholm midnight, in winter and in summer", () => {
    const january = stockholmRange("month", 0, new Date("2026-01-15T12:00:00Z"));
    expect(january.from.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(january.to.toISOString()).toBe("2026-01-31T23:00:00.000Z");

    const july = stockholmRange("month", 0, new Date("2026-07-15T12:00:00Z"));
    expect(july.from.toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });

  it("spans the daylight-saving changes correctly", () => {
    // March 2026 loses an hour on the 29th; October gains one on the 25th.
    const march = stockholmRange("month", 0, new Date("2026-03-20T12:00:00Z"));
    expect(march.from.toISOString()).toBe("2026-02-28T23:00:00.000Z");
    expect(march.to.toISOString()).toBe("2026-03-31T22:00:00.000Z");
    const changeDay = stockholmRange("day", 0, new Date("2026-10-25T12:00:00Z"));
    expect(changeDay.to.getTime() - changeDay.from.getTime()).toBe(25 * 3600 * 1000);
  });

  it("counts a late-night finish in the Stockholm day, not the UTC one", () => {
    // 23:30 in Stockholm on 31 January is still January there, though UTC says 22:30.
    const now = new Date("2026-01-31T22:30:00Z");
    expect(stockholmRange("month", 0, now).from.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    // 00:30 on 1 February in Stockholm is February, though UTC still says January.
    const justAfter = new Date("2026-01-31T23:30:00Z");
    expect(stockholmRange("month", 0, justAfter).from.toISOString()).toBe("2026-01-31T23:00:00.000Z");
  });

  it("starts weeks on Monday and steps back by offset", () => {
    // Saturday 17 October 2026.
    const week = stockholmRange("week", 0, new Date("2026-10-17T10:00:00Z"));
    expect(week.from.toISOString()).toBe("2026-10-11T22:00:00.000Z");
    const previous = stockholmRange("week", -1, new Date("2026-10-17T10:00:00Z"));
    expect(previous.to.toISOString()).toBe(week.from.toISOString());
    const lastMonth = stockholmRange("month", -1, new Date("2026-01-15T12:00:00Z"));
    expect(lastMonth.from.toISOString()).toBe("2025-11-30T23:00:00.000Z");
  });
});

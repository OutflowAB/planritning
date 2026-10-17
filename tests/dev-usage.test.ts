import { describe, expect, it } from "vitest";

import {
  aiCostPerGenerationSek,
  buildDevUsage,
  stockholmMonthKey,
  type UsageSettings,
  usageMonths,
} from "@/lib/dev-usage";
import { roleMayUse } from "@/lib/server-auth";

const settings: UsageSettings = { planPriceSek: 50, aiCostPerGenerationSek: 4, aiMonthlyCap: 1000 };
const now = new Date("2026-10-17T12:00:00Z");

describe("usageMonths", () => {
  it("lists six Stockholm months, newest first, across a year end", () => {
    expect(usageMonths(now).keys).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
    expect(usageMonths(new Date("2026-02-10T12:00:00Z"), 3).keys).toEqual(["2026-02", "2026-01", "2025-12"]);
  });

  it("puts midnight at the turn of the month in Stockholm, not UTC", () => {
    // 23:30 UTC on 30 September is 01:30 on 1 October in Stockholm.
    expect(stockholmMonthKey(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10");
  });
});

describe("buildDevUsage", () => {
  const usage = buildDevUsage({
    now,
    settings,
    rows: [
      { month: "2026-10", owner_id: "a", plans: 8, billed_ore: 40000, generations: 10 },
      { month: "2026-10", owner_id: "b", plans: 2, billed_ore: 10000, generations: 0 },
      { month: "2026-09", owner_id: "a", plans: 1, billed_ore: 5000, generations: 3 },
    ],
    storage: [
      { owner_id: "a", images: 4, bytes: 2_097_152 },
      { owner_id: "b", images: 1, bytes: 1_048_576 },
    ],
    profiles: [
      { id: "a", display_name: "Anna", role: "user" },
      { id: "b", display_name: "Bo", role: "user" },
      { id: "c", display_name: "Cecilia", role: "user" },
      { id: "s", display_name: "Superadmin", role: "admin" },
    ],
  });

  it("adds up each month, with empty months included, and the margin after the estimated AI cost", () => {
    expect(usage.months).toHaveLength(6);
    expect(usage.months[0]).toEqual({ month: "2026-10", plans: 10, billedSek: 500, generations: 10, aiCostSek: 40, marginSek: 460 });
    expect(usage.months[1]).toMatchObject({ month: "2026-09", plans: 1, billedSek: 50, aiCostSek: 12, marginSek: 38 });
    expect(usage.months[5]).toMatchObject({ month: "2026-05", plans: 0, billedSek: 0, marginSek: 0 });
  });

  it("lists realtors only, biggest spender first, including one with nothing yet", () => {
    expect(usage.realtors.map((r) => r.displayName)).toEqual(["Anna", "Bo", "Cecilia"]);
    expect(usage.realtors[0]).toMatchObject({ plans: 8, billedSek: 400, generations: 10, aiCostSek: 40, images: 4, storageMb: 2 });
    expect(usage.realtors[2]).toMatchObject({ plans: 0, billedSek: 0, images: 0, storageMb: 0 });
    expect(usage.totals).toEqual({ realtors: 3, images: 5, storageMb: 3 });
  });
});

describe("aiCostPerGenerationSek", () => {
  it("uses the setting, and a default for a missing or bad one", () => {
    expect(aiCostPerGenerationSek("2.5")).toBe(2.5);
    expect(aiCostPerGenerationSek(undefined)).toBe(4);
    expect(aiCostPerGenerationSek("abc")).toBe(4);
    expect(aiCostPerGenerationSek("-1")).toBe(4);
  });
});

describe("roleMayUse", () => {
  it("keeps the developer account to its own routes, and everyone else out of them", () => {
    expect(roleMayUse("dev", { role: "dev" })).toBe(true);
    expect(roleMayUse("dev", {})).toBe(false); // a realtor route
    expect(roleMayUse("dev", { role: "admin" })).toBe(false);
    expect(roleMayUse("dev", { allowDev: true })).toBe(true); // changing its own password
    expect(roleMayUse("user", { role: "dev" })).toBe(false);
    expect(roleMayUse("admin", { role: "dev" })).toBe(false);
  });

  it("leaves realtors and the superadmin as they were", () => {
    expect(roleMayUse("user", {})).toBe(true);
    expect(roleMayUse("admin", {})).toBe(true);
    expect(roleMayUse("admin", { role: "admin" })).toBe(true);
    expect(roleMayUse("user", { role: "admin" })).toBe(false);
  });
});

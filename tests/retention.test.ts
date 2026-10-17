import { describe, expect, it } from "vitest";

import { isPurgeDue } from "@/lib/retention";

const now = new Date("2026-10-17T03:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();

describe("isPurgeDue", () => {
  it("removes uploaded originals after 90 days, once", () => {
    expect(isPurgeDue({ file_path: "uploads/a.jpg", created_at: daysAgo(91), purged_at: null }, now)).toBe(true);
    expect(isPurgeDue({ file_path: "uploads/a.jpg", created_at: daysAgo(89), purged_at: null }, now)).toBe(false);
    expect(isPurgeDue({ file_path: "uploads/a.jpg", created_at: daysAgo(200), purged_at: daysAgo(100) }, now)).toBe(false);
  });

  it("never touches plans", () => {
    expect(isPurgeDue({ file_path: "generated/a.png", created_at: daysAgo(400), purged_at: null }, now)).toBe(false);
  });
});

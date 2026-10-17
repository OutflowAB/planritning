import { describe, expect, it } from "vitest";

import { scopeToOwner } from "@/lib/ownership";

/** A stand-in for a Supabase query that records its filters. */
function fakeQuery(filters: [string, unknown][] = []) {
  return {
    filters,
    eq(column: string, value: unknown) {
      return fakeQuery([...filters, [column, value]]);
    },
  };
}

const realtor = { userId: "realtor-1", isAdmin: false };
const superadmin = { userId: "admin-1", isAdmin: true };

describe("scopeToOwner", () => {
  it("limits a realtor to their own rows", () => {
    expect(scopeToOwner(fakeQuery(), realtor).filters).toEqual([["owner_id", "realtor-1"]]);
  });

  it("lets a superadmin read everyone's rows but change only their own", () => {
    expect(scopeToOwner(fakeQuery(), superadmin).filters).toEqual([]);
    expect(scopeToOwner(fakeQuery(), superadmin, { forChange: true }).filters).toEqual([["owner_id", "admin-1"]]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearListCache, readListCache, writeListCache } from "@/lib/list-cache";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

beforeEach(() => {
  vi.stubGlobal("window", { sessionStorage: new MemoryStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("list cache", () => {
  it("round-trips rows", () => {
    writeListCache("k", [{ id: 1 }, { id: 2 }]);
    expect(readListCache<{ id: number }>("k")).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("returns null for a missing key", () => {
    expect(readListCache("nope")).toBeNull();
  });

  it("expires and clears itself", () => {
    vi.useFakeTimers();
    writeListCache("k", [{ id: 1 }], 1000);
    vi.advanceTimersByTime(1001);
    expect(readListCache("k")).toBeNull();
    expect(window.sessionStorage.getItem("k")).toBeNull();
  });

  it("survives corrupt storage", () => {
    window.sessionStorage.setItem("k", "{not json");
    expect(readListCache("k")).toBeNull();
  });

  it("does not throw when storage is over quota", () => {
    window.sessionStorage.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    expect(() => writeListCache("k", [{ id: 1 }])).not.toThrow();
  });

  it("clears", () => {
    writeListCache("k", [1]);
    clearListCache("k");
    expect(readListCache("k")).toBeNull();
  });
});

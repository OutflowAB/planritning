import { beforeAll, describe, expect, it } from "vitest";

import { createSessionCookieValue, credentialsMatch, readSessionRole } from "@/lib/server-auth";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-not-for-production";
});

describe("session cookie", () => {
  it("round-trips a role", () => {
    expect(readSessionRole(createSessionCookieValue("admin"))).toBe("admin");
    expect(readSessionRole(createSessionCookieValue("user"))).toBe("user");
  });

  it("rejects the old plaintext format", () => {
    expect(readSessionRole("admin")).toBeNull();
    expect(readSessionRole("user")).toBeNull();
  });

  it("rejects a tampered role", () => {
    const cookie = createSessionCookieValue("user");
    const forged = cookie.replace(".user.", ".admin.");
    expect(readSessionRole(forged)).toBeNull();
  });

  it("rejects a tampered expiry", () => {
    const cookie = createSessionCookieValue("user", 60);
    const [version, role, , signature] = cookie.split(".");
    const farFuture = Date.now() + 10 * 365 * 24 * 3600 * 1000;
    expect(readSessionRole(`${version}.${role}.${farFuture}.${signature}`)).toBeNull();
  });

  it("rejects an expired session", () => {
    expect(readSessionRole(createSessionCookieValue("user", -1))).toBeNull();
  });

  it("rejects a signature made with another secret", () => {
    const cookie = createSessionCookieValue("admin");
    process.env.AUTH_SECRET = "a-different-secret";
    expect(readSessionRole(cookie)).toBeNull();
    process.env.AUTH_SECRET = "test-secret-not-for-production";
  });

  it("rejects garbage", () => {
    expect(readSessionRole(undefined)).toBeNull();
    expect(readSessionRole("")).toBeNull();
    expect(readSessionRole("v1.admin")).toBeNull();
    expect(readSessionRole("v2.admin.1.abc")).toBeNull();
  });
});

describe("credentialsMatch", () => {
  it("matches equal strings and nothing else", () => {
    expect(credentialsMatch("hemligt", "hemligt")).toBe(true);
    expect(credentialsMatch("hemligt", "hemligt ")).toBe(false);
    expect(credentialsMatch("", "")).toBe(true);
    expect(credentialsMatch("a", "")).toBe(false);
  });
});

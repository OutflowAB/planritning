import { beforeAll, describe, expect, it } from "vitest";

import {
  createSessionCookieValue,
  isThrottled,
  passwordProblem,
  readSessionCookie,
} from "@/lib/server-auth";

const USER = "6f1c2e0a-9d7b-4c3e-8a51-2b7d9e4f0c11";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-not-for-production";
});

describe("session cookie", () => {
  it("round-trips the user and session version", () => {
    expect(readSessionCookie(createSessionCookieValue(USER, 3))).toEqual({ userId: USER, sessionVersion: 3 });
  });

  it("rejects cookies from the old shared login", () => {
    expect(readSessionCookie("v1.admin.9999999999999.abc")).toBeNull();
    expect(readSessionCookie("admin")).toBeNull();
  });

  it("rejects a tampered user or session version", () => {
    const cookie = createSessionCookieValue(USER, 1);
    const otherUser = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
    expect(readSessionCookie(cookie.replace(USER, otherUser))).toBeNull();
    const [format, user, , expires, signature] = cookie.split(".");
    expect(readSessionCookie(`${format}.${user}.2.${expires}.${signature}`)).toBeNull();
  });

  it("rejects a tampered or passed expiry", () => {
    const [format, user, version, , signature] = createSessionCookieValue(USER, 1, 60).split(".");
    expect(readSessionCookie(`${format}.${user}.${version}.${Date.now() + 1e12}.${signature}`)).toBeNull();
    expect(readSessionCookie(createSessionCookieValue(USER, 1, -1))).toBeNull();
  });

  it("rejects a signature made with another secret", () => {
    const cookie = createSessionCookieValue(USER, 1);
    process.env.AUTH_SECRET = "a-different-secret";
    expect(readSessionCookie(cookie)).toBeNull();
    process.env.AUTH_SECRET = "test-secret-not-for-production";
  });

  it("rejects garbage", () => {
    expect(readSessionCookie(undefined)).toBeNull();
    expect(readSessionCookie("")).toBeNull();
    expect(readSessionCookie("v2.not-a-uuid.1.1.abc")).toBeNull();
  });
});

describe("login throttling", () => {
  it("refuses after 5 failures for an email or 30 from one address", () => {
    expect(isThrottled({ email: 4, ip: 29 })).toBe(false);
    expect(isThrottled({ email: 5, ip: 0 })).toBe(true);
    expect(isThrottled({ email: 0, ip: 30 })).toBe(true);
  });
});

describe("passwordProblem", () => {
  it("asks for at least 10 characters", () => {
    expect(passwordProblem("kort")).toMatch(/minst 10/);
    expect(passwordProblem("tillräckligt-långt")).toBeNull();
  });
});

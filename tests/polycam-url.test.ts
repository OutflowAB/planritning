import { describe, expect, it } from "vitest";

import { parsePolycamCaptureId, polycamCaptureUrl } from "@/lib/polycam/url";

const ID = "FA402246-4F1C-48EA-886A-C4E773CD7E4E";

describe("parsePolycamCaptureId", () => {
  it.each([
    `https://poly.cam/capture/${ID}`,
    `https://poly.cam/capture/${ID}/`,
    `  https://poly.cam/capture/${ID}  `,
    `https://POLY.CAM/capture/${ID}`,
    `https://poly.cam/capture/${ID.toLowerCase()}`,
    `https://poly.cam/capture/${ID}?utm_source=share`,
    `https://poly.cam/capture/${ID}#view`,
    `https://poly.cam/explore/capture/${ID}`,
    `https://poly.cam/explore/capture/${ID}/Sep-21-0850-AM`,
    `https://poly.cam/explore/capture/${ID}/Sep-21-0850-AM/`,
  ])("accepts %s", (input) => {
    expect(parsePolycamCaptureId(input)).toBe(ID);
  });

  it.each([
    // Wrong scheme or no scheme.
    `http://poly.cam/capture/${ID}`,
    `poly.cam/capture/${ID}`,
    `//poly.cam/capture/${ID}`,
    `ftp://poly.cam/capture/${ID}`,
    `javascript:alert(1)//poly.cam/capture/${ID}`,
    // Other or lookalike hosts.
    `https://poly.cam.evil.com/capture/${ID}`,
    `https://evilpoly.cam/capture/${ID}`,
    `https://www.poly.cam/capture/${ID}`,
    `https://api.poly.cam/capture/${ID}`,
    `https://poly.cam./capture/${ID}`,
    `https://poly.com/capture/${ID}`,
    `https://xn--ply-8cd.cam/capture/${ID}`,
    `https://pоly.cam/capture/${ID}`, // Cyrillic о
    // IPs and localhost.
    `https://127.0.0.1/capture/${ID}`,
    `https://[::1]/capture/${ID}`,
    `https://169.254.169.254/capture/${ID}`,
    `https://localhost/capture/${ID}`,
    // Userinfo and ports.
    `https://user:pass@poly.cam/capture/${ID}`,
    `https://poly.cam@evil.com/capture/${ID}`,
    `https://evil.com@poly.cam/capture/${ID}`,
    `https://poly.cam:8443/capture/${ID}`,
    `https://poly.cam:443x/capture/${ID}`,
    // Path tricks.
    `https://poly.cam/capture/${ID}/../../api`,
    `https://poly.cam/capture/${ID}/extra`,
    `https://poly.cam/api/capture/${ID}/artifacts/optimized_roomplan.json`,
    `https://poly.cam/scene/${ID}`,
    `https://poly.cam/capture/${ID}%2F..%2F`,
    `https://poly.cam/explore/capture/${ID}/slug/more`,
    `https://poly.cam/explore/capture/${ID}/bad%20slug`,
    `https://poly.cam\\@evil.com/capture/${ID}`,
    // Not a UUID.
    "https://poly.cam/capture/",
    "https://poly.cam/capture/abc",
    "https://poly.cam/capture/FA402246-4F1C-48EA-886A-C4E773CD7E4",
    "https://poly.cam/capture/FA402246-4F1C-48EA-886A-C4E773CD7E4EE",
    "https://poly.cam/capture/GA402246-4F1C-48EA-886A-C4E773CD7E4E",
    "https://poly.cam/capture/FA4022464F1C48EA886AC4E773CD7E4E",
    // Garbage.
    "",
    "   ",
    `https://poly.cam/capture/${ID}${"/".repeat(600)}`,
  ])("rejects %s", (input) => {
    expect(parsePolycamCaptureId(input)).toBeNull();
  });

  it("rejects values that are not strings", () => {
    expect(parsePolycamCaptureId(undefined)).toBeNull();
    expect(parsePolycamCaptureId(null)).toBeNull();
    expect(parsePolycamCaptureId(42)).toBeNull();
    expect(parsePolycamCaptureId({ toString: () => `https://poly.cam/capture/${ID}` })).toBeNull();
    expect(parsePolycamCaptureId([`https://poly.cam/capture/${ID}`])).toBeNull();
  });
});

describe("polycamCaptureUrl", () => {
  it("rebuilds the canonical link from the id", () => {
    expect(polycamCaptureUrl(ID)).toBe(`https://poly.cam/capture/${ID}`);
  });
});

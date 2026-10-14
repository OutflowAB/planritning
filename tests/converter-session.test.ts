import { afterEach, describe, expect, it } from "vitest";

import {
  hasUnfinishedConverterSession,
  setConverterConversionInFlight,
} from "@/lib/startsida-converter-session";

describe("converter session", () => {
  afterEach(() => setConverterConversionInFlight(false));

  it("counts a running conversion as unfinished, so leaving the page does not reset the converter", () => {
    // A pasted Polycam link stores no source selection; only the in-flight flag protects it.
    expect(hasUnfinishedConverterSession()).toBe(false);
    setConverterConversionInFlight(true);
    expect(hasUnfinishedConverterSession()).toBe(true);
    setConverterConversionInFlight(false);
    expect(hasUnfinishedConverterSession()).toBe(false);
  });
});

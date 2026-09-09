import { describe, expect, it } from "vitest";

import {
  imageDownloadFileName,
  imageExtensionFromFilePath,
  imageExtensionFromMimeType,
  resolveImageDownloadFileName,
} from "@/lib/image-naming";
import { thumbnailPath } from "@/lib/image/thumbnail";

describe("image naming", () => {
  it("normalises the extension", () => {
    expect(imageDownloadFileName(7, ".PNG")).toBe("bild-7.png");
    expect(imageDownloadFileName(7, "")).toBe("bild-7.png");
  });

  it("prefers an explicit format, then mime, then path", () => {
    expect(resolveImageDownloadFileName(3, { format: "svg", mimeType: "image/png" })).toBe("bild-3.svg");
    expect(resolveImageDownloadFileName(3, { mimeType: "image/jpeg", filePath: "x.png" })).toBe("bild-3.jpg");
    expect(resolveImageDownloadFileName(3, { filePath: "uploads/a.webp" })).toBe("bild-3.webp");
    expect(resolveImageDownloadFileName(3)).toBe("bild-3.png");
  });

  it("rejects absurd extensions from paths", () => {
    expect(imageExtensionFromFilePath("a.toolongext")).toBeNull();
    expect(imageExtensionFromMimeType("text/html")).toBeNull();
  });
});

describe("thumbnailPath", () => {
  it("keys the derivative on the source version", () => {
    const a = thumbnailPath("generated/123-abc.png", '"c5c56f736ad8"');
    const b = thumbnailPath("generated/123-abc.png", '"deadbeef1234"');
    expect(a).toBe("thumbs/123-abc-c5c56f73.webp");
    expect(a).not.toBe(b);
  });

  it("copes with a missing version", () => {
    expect(thumbnailPath("uploads/x.jpg", "")).toBe("thumbs/x-0.webp");
  });
});

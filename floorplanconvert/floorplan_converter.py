#!/usr/bin/env python3
"""
Inbyggd planritnings-export: läser källbilden och skriver PNG.

CLI matchar anropet från Next.js (`lib/floorplan-jobs.ts`). Flaggor för
upscale/OCR kan ignoreras här tills tyngre beroenden finns i miljön —
logga tydligt så flödet går att följa i SSE-loggen.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, UnidentifiedImageError


def main() -> int:
    parser = argparse.ArgumentParser(description="Floorplan image → PNG")
    parser.add_argument("input_path", type=Path)
    parser.add_argument("--output_path", type=Path, required=True)
    parser.add_argument("--no_upscale", action="store_true", help="Skip upscale (fast path)")
    parser.add_argument("--replace_text", action="store_true", help="Replace detected labels (optional)")
    parser.add_argument("--font_path", type=Path, help="Font for text replacement")
    args = parser.parse_args()

    if args.no_upscale:
        print("[speed] Embedded converter: upscale skipped.", flush=True)
    if args.replace_text:
        font = args.font_path or Path()
        if font.is_file():
            print(f"[info] Text replacement requested (font: {font.name}) — embedded build exports image only.", flush=True)
        else:
            print("[info] Text replacement skipped (no font file).", flush=True)

    try:
        img = Image.open(args.input_path)
    except UnidentifiedImageError:
        print("error: Could not read image file.", file=sys.stderr, flush=True)
        return 1
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr, flush=True)
        return 1

    args.output_path.parent.mkdir(parents=True, exist_ok=True)

    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img.save(args.output_path, "PNG", optimize=True)
    elif img.mode == "P":
        img.convert("RGBA").save(args.output_path, "PNG", optimize=True)
    else:
        img.convert("RGB").save(args.output_path, "PNG", optimize=True)

    print(f"Done: {args.output_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Roadmap — planritning-lidar

Goal: a realtor scans a home (RoomPlan on a LiDAR iPhone, or a Polycam file) and gets a
branded, editable floor plan. This repo starts as a copy of `planritning`, whose editor,
symbol library, export and storage are reused; scans become a new way in next to
"upload an old drawing".

```
Old drawing upload (exists) ─┐
RoomPlan scan (new) ─────────┼─► FloorplanDocument ─► existing editor ─► existing export
Polycam file (new) ──────────┘
```

## Done

- [x] Copy of `planritning` as a new repo, identity `rodanc1 <rodanc111@gmail.com>`
- [x] `dev` branch + Controllen's git rules in `CLAUDE.md`
- [x] `npm install`, app starts
- [x] Hosted Supabase project, `.env.local`, schema (`supabase/migrations/20261015000000_init.sql`), private `planritningar` bucket
- [x] Local Supabase in Docker (ports 563xx), `npm run dev:local`, local test logins in `.env.docker.local`
- [x] OpenAI settings in `.env.local`; AI redraw verified on a test drawing (89 s, good result)
- [x] Local Docker setup and this roadmap committed on `dev`
- [x] Generated test image #3 approved
- [x] Admin "Konvertera" button removed — the converter only runs in the realtor panel (bug from `planritning` too)
- [x] `README.md` updated: no anon key, schema in `supabase/migrations/`, `dev:local`, ports

## Skipped for now

5. Rename the app (`package.json` name `sm-planritning`, page titles) when the product name is decided
6. Cheaper OpenAI settings for local tests in `.env.docker.local` (`OPENAI_IMAGE_QUALITY=low`)
9. `supabase link` — instead, paste each new file in `supabase/migrations/` into the hosted project's SQL Editor by hand

## Before anything is shared

- [x] 7. GitHub repo `rodanc1/planritning-lidar` (private), `main` and `dev` pushed
- [x] 8. CI like Controllen's: type-check, lint, tests, build on `dev` and `main`
- [x] 10. Security upgrades: Next 16.4.1, sharp 0.35.5, vitest 5 — `npm audit` down from 19 to 5. The 5 left are one `braces` issue inside the lint plugin (dev-only, no fixed release yet). The live `planritning` still has the old versions.
11. Rotate the Supabase secret key and the OpenAI key (both were pasted into a chat), update `.env.local`
- [x] Fix: a full page reload of any logged-in page sent you to Startsida — `ProtectedRoute` redirected on its first client render, before reading the stored session. Still broken in the live `planritning`.

## Phase 1 — web app accepts scans (no phone needed)

- [x] 12. Start a plan without an uploaded drawing: "Ny tom planritning" in Planritningar creates an approved plan whose image is an empty brand canvas (beige, frame, logo, 7:5, 1200×800 drawing area) under `generated/blank-`. Editor, autosave, Slutför, library and export work on it unchanged; it is not counted or billed as an AI generation. A scan import will start from the same blank plan. Migration `20261015140000_blank_floorplans.sql`.
- [x] 13. Scale folded into 15: a scanned plan keeps `scale.pxPerMeter` on its document. The editor features that use it moved to 16.
- [x] 14. Hand-written test rooms in `tests/fixtures/scans/`: rectangle, L-shape, two rooms joined by a door. They also work as import files.
- [x] 15. Scan import: "Importera skanning" in Planritningar takes a scan JSON (format: `lib/floorplan/scan-import.ts` — metres, top-down, openings given by wall + offset), validates it on the server and opens it in Verktyg as a blank plan with walls (split at openings), doors, windows and room labels, fitted and centred with its scale stored. Blank and scanned plans keep their editable document after Slutför (drawn on the untouched canvas from `GET /api/blank-floorplan`).

## Phase 2 — realtor features

- [x] 16. Measuring, in the editor only — the house style (`assets/style-references/STILREGLER.md`) puts no dimensions or areas on the plans. Rooms with a scanned `outline` get an area: shown as "Yta ca X m²" when the room label is selected, and "Total yta" when nothing is. On a plan with a scale: wall length for a selected wall, door/window width in metres, new dimension lines label themselves ("8,0 m"), and new doors, windows and stairs get real sizes. Room names are imported in capitals, as the style requires. Not yet SS 21054 (BOA/BIA) — the area is the scanned floor polygon.
- [x] 17. A scanned wall's pieces and its doors and windows share a `wallId`; dragging any piece drags them all (one undo step). Corners do not follow — connected walls are not stretched. Hand-drawn objects are not tied.
- [x] 18. ~~Upload page for scan files~~ — covered by "Importera skanning" for now
- [x] 19. Scan `objects` (RoomPlan categories): toilet, bathtub, sink, stove, oven, refrigerator, washerDryer become symbols; stairs become a stair. Furniture (bed, sofa, table, chair…) is left out — the house style never draws it. Orientation follows `rotation`; how RoomPlan's own orientation maps to it is unverified until real scans.
- [x] Door symbol cleaned up (leaf and arc only); doors can be flipped with "Byt sida", since a scan cannot tell which way a door opens.

## Phase 3 — real scan data

- [x] Own RoomPlan app (`ios/`, see Phase 4) and a first real scan. Import now straightens scans to the house's own axes, closes up wall noise (pieces within 10 cm on one line, ends within 10 cm meet), turns small doorless wall boxes into wardrobes, keeps abbreviations upright, and draws bathroom sinks as washbasins. Diagonal walls draw correctly in the editor.
- [x] Second, careful scan: a wardrobe box standing out from a gap gets its back wall drawn, kitchen cabinets become one worktop outline per wall, and a cooker is drawn as its hob only (RoomPlan also reports the oven under it).
- Rules must hold for every kind of property, not the one flat they were tried on. Known limits:
  - Wall thickness: RoomPlan reports none, so all walls get 15 cm; the style wants outer walls thicker than inner ones.
  - Several rooms in one scan: RoomPlan gives one floor outline, so rooms get no area and fittings are matched to the nearest room centre.
  - A chimney or shaft the size of a wardrobe can be taken for one (one click to delete).
  - Wall steps under 10 cm are treated as noise and closed up.
  - One floor per scan; several floors are not combined.
  - A fridge built into a tall kitchen cabinet comes back as "storage" and is drawn as worktop; K/F is added by hand.
20. Get 5–10 real scans: Polycam Room mode on a borrowed LiDAR iPhone, exported as USDZ
21. Polycam USDZ importer (likely a small server-side conversion; check three.js USDZ support first)
22. Measure a few rooms by hand and compare with the scans for accuracy

## Phase 4 — own scanner app

23. LiDAR device for testing (used iPhone 12/13 Pro or iPad Pro 2020+)
24. Minimal iOS app with RoomPlan: scan rooms, merge, upload to the web app
25. Paid Apple Developer account, TestFlight with a couple of realtors

## Later / optional

26. DXF import
27. Mesh slicing for non-LiDAR Polycam scans (photo mode)
28. Multiple floors
29. Remove the AI-redraw parts if this product doesn't need them

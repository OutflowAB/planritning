-- A name for an image that people choose themselves, usually the property's address
-- ("Storgatan 12, Göteborg"). Set on a generated plan and on the original it was drawn from,
-- so both lists can show it and the archive can be searched by it. Null when nobody named it.
--
-- The app reads this column best-effort and keeps working before this migration has run;
-- names simply cannot be saved until it has.

alter table public.uploaded_images
  add column if not exists label text;

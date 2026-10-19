-- The floor a plan shows ("ENTRÉPLAN", "PLAN 2"…), printed on a finished scanned plan beside its
-- address. The address itself is the image's existing label (database/2026-10-15-uploaded-images-label.sql).
-- The app reads this column best-effort and keeps working before this has run: the floor is simply
-- not saved.

alter table public.uploaded_images
  add column if not exists floor_label text;

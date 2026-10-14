-- Where a source image came from when it was not uploaded as a file: the Polycam capture link
-- (rebuilt from the capture id, https://poly.cam/capture/{id}) for plans drawn from a 3D scan.
-- Null for ordinary uploads and for generated images.
--
-- The app writes this column best-effort and never reads it, so it keeps working before this
-- migration has run; links are simply not recorded until it has.

alter table public.uploaded_images
  add column if not exists source_url text;

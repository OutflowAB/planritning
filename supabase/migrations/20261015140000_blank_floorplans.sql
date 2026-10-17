-- Blank floor plans (and later scans) are generated plans with no uploaded original.
-- They live under generated/blank-, so every other generated row still needs its source.

alter table public.uploaded_images
  drop constraint if exists uploaded_images_generated_requires_source_chk;

alter table public.uploaded_images
  add constraint uploaded_images_generated_requires_source_chk
  check (
    file_path not like 'generated/%'
    or file_path like 'generated/blank-%'
    or source_upload_id is not null
  );

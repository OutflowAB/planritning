-- Plans started from a LiDAR scan (or empty) rather than from an upload. They are stored like
-- an approved generation under generated/blank-, with no source upload to point at.
--
-- 1. Generated rows still need a source upload, except blank and scanned plans.
-- 2. floor_plan_documents.source_document keeps the plan as first imported, which "Original"
--    in the editor returns to.
--
-- The app reads source_document best-effort and keeps working before this migration has run;
-- scans simply cannot be stored until the constraint allows them, and "Original" clears the
-- plan instead of restoring the scan.

alter table public.uploaded_images
  drop constraint if exists uploaded_images_generated_requires_source_chk;

alter table public.uploaded_images
  add constraint uploaded_images_generated_requires_source_chk
  check (
    file_path not like 'generated/%'
    or file_path like 'generated/blank-%'
    or source_upload_id is not null
  ) not valid;

alter table public.floor_plan_documents
  add column if not exists source_document jsonb;

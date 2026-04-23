-- Ensure generated images are linked to a source upload.
-- New generated rows must set source_upload_id, and deleting a source upload cascades row deletion.

alter table public.uploaded_images
  add column if not exists source_upload_id bigint;

alter table public.uploaded_images
  drop constraint if exists uploaded_images_source_upload_id_fkey;

alter table public.uploaded_images
  add constraint uploaded_images_source_upload_id_fkey
  foreign key (source_upload_id)
  references public.uploaded_images(id)
  on delete cascade;

create index if not exists idx_uploaded_images_source_upload_id
  on public.uploaded_images(source_upload_id);

alter table public.uploaded_images
  drop constraint if exists uploaded_images_generated_requires_source_chk;

alter table public.uploaded_images
  add constraint uploaded_images_generated_requires_source_chk
  check (
    file_path not like 'generated/%'
    or source_upload_id is not null
  ) not valid;

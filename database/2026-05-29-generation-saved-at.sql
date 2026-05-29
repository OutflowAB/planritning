-- Track when an approved generated image is saved from Verktyg to Planritningar.

alter table public.uploaded_images
  add column if not exists saved_at timestamptz;

create index if not exists idx_uploaded_images_saved_at
  on public.uploaded_images(saved_at desc)
  where saved_at is not null;

-- Keep existing approved generated images visible in Planritningar.
update public.uploaded_images ui
set saved_at = ui.created_at
where ui.file_path like 'generated/%'
  and ui.saved_at is null
  and exists (
    select 1
    from public.generation_reviews gr
    where gr.image_id = ui.id
      and gr.decision = 'approved'
  );

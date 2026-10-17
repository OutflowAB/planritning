-- Full schema for a fresh Supabase project. Applied automatically by `supabase start` locally;
-- for a hosted project, run it once in the SQL editor (or `supabase db push`).
-- Combines the dated files in database/, plus the uploaded_images table they assume
-- already exists. Columns are taken from what the code reads and writes.

create table if not exists public.uploaded_images (
  id bigint generated always as identity primary key,
  file_name text not null,
  file_path text not null,
  file_size bigint not null,
  mime_type text,
  created_at timestamptz not null default now(),
  saved_at timestamptz,
  source_upload_id bigint references public.uploaded_images(id) on delete cascade,
  constraint uploaded_images_generated_requires_source_chk
    check (file_path not like 'generated/%' or source_upload_id is not null)
);

create index if not exists idx_uploaded_images_created_at
  on public.uploaded_images(created_at desc);

create index if not exists idx_uploaded_images_source_upload_id
  on public.uploaded_images(source_upload_id);

create index if not exists idx_uploaded_images_saved_at
  on public.uploaded_images(saved_at desc)
  where saved_at is not null;

create table if not exists public.generation_reviews (
  id bigint generated always as identity primary key,
  image_id bigint,
  file_path text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_generation_reviews_image_id
  on public.generation_reviews(image_id);

create index if not exists idx_generation_reviews_created_at
  on public.generation_reviews(created_at desc);

create table if not exists public.floor_plan_documents (
  id bigint generated always as identity primary key,
  image_id bigint not null,
  file_path text not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (image_id, file_path)
);

create index if not exists idx_floor_plan_documents_image_id
  on public.floor_plan_documents(image_id);

create index if not exists idx_floor_plan_documents_updated_at
  on public.floor_plan_documents(updated_at desc);

-- The browser never talks to Supabase; the server uses the service role, which bypasses RLS.
-- RLS with no policies keeps the public key out (see 2026-09-09-lock-down-anon.sql).
alter table public.uploaded_images enable row level security;
alter table public.generation_reviews enable row level security;
alter table public.floor_plan_documents enable row level security;

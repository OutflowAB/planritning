-- Store approve/reject decisions for generated floor plans.

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

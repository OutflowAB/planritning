-- Structured floor plan documents for the editor (JSON source of truth).

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

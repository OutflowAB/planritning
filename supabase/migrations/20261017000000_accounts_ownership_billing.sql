-- Per-realtor accounts, ownership of every plan, and billing per finished plan.
-- Assumes a fresh database: owner_id is required, so existing rows without an owner must be
-- removed first (locally: `supabase db reset`).

-- Who can sign in. Passwords live in Supabase Auth; this row holds what the app decides on.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  must_change_password boolean not null default true,
  disabled boolean not null default false,
  -- Bumped to sign the user out everywhere (password change, reset, disable).
  session_version integer not null default 1,
  created_at timestamptz not null default now()
);

alter table public.uploaded_images
  add column if not exists owner_id uuid not null references public.profiles(id) on delete restrict,
  add column if not exists address text,
  add column if not exists floor_label text,
  add column if not exists published_path text,
  add column if not exists published_at timestamptz,
  add column if not exists purged_at timestamptz,
  add column if not exists engine text;

create index if not exists idx_uploaded_images_owner_created
  on public.uploaded_images(owner_id, created_at desc);

create index if not exists idx_uploaded_images_owner_published
  on public.uploaded_images(owner_id, published_at desc);

-- Reviews and documents go with their image, so deleting a plan leaves nothing behind.
delete from public.generation_reviews r
  where r.image_id is null
     or not exists (select 1 from public.uploaded_images i where i.id = r.image_id);
alter table public.generation_reviews
  alter column image_id set not null,
  drop constraint if exists generation_reviews_image_id_fkey,
  add constraint generation_reviews_image_id_fkey
    foreign key (image_id) references public.uploaded_images(id) on delete cascade;

delete from public.floor_plan_documents d
  where not exists (select 1 from public.uploaded_images i where i.id = d.image_id);
alter table public.floor_plan_documents
  drop constraint if exists floor_plan_documents_image_id_fkey,
  add constraint floor_plan_documents_image_id_fkey
    foreign key (image_id) references public.uploaded_images(id) on delete cascade,
  -- The plan as first created (an imported scan), which "Original" returns to.
  add column if not exists source_document jsonb,
  -- The plan as last finished, which downloads are made from.
  add column if not exists published_document jsonb;

-- One row per "Slutför". Append-only: the code never updates or deletes these rows.
create table if not exists public.billing_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  image_id bigint references public.uploaded_images(id) on delete set null,
  price_ore integer not null check (price_ore >= 0),
  address text,
  floor_label text,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_events_owner_created
  on public.billing_events(owner_id, created_at desc);
create index if not exists idx_billing_events_created
  on public.billing_events(created_at desc);

-- One row per AI redraw, for the firm-wide monthly cap.
create table if not exists public.generation_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  engine text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_generation_events_created
  on public.generation_events(created_at desc);

-- Failed sign-ins, for throttling. Pruned by the daily purge.
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_login_attempts_email on public.login_attempts(email, created_at desc);
create index if not exists idx_login_attempts_ip on public.login_attempts(ip, created_at desc);

-- As for the other tables: the browser never talks to Supabase, and no policies keep the
-- public key out.
alter table public.profiles enable row level security;
alter table public.billing_events enable row level security;
alter table public.generation_events enable row level security;
alter table public.login_attempts enable row level security;

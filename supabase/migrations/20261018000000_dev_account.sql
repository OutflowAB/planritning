-- A developer account that sees spending and usage, never anyone's plans. There is exactly one:
-- the unique index allows a single row with role 'dev'.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'admin', 'dev'));

create unique index if not exists profiles_one_dev on public.profiles ((role)) where role = 'dev';

-- Finished plans (billed) and AI redraws per Stockholm calendar month and realtor, from `since`.
-- Summed in the database, so the totals are exact however many rows there are.
create or replace function public.dev_usage(since timestamptz)
returns table (month text, owner_id uuid, plans bigint, billed_ore bigint, generations bigint)
language sql
stable
as $$
  with billed as (
    select to_char(created_at at time zone 'Europe/Stockholm', 'YYYY-MM') as month,
           b.owner_id, count(*) as plans, sum(price_ore) as billed_ore
    from public.billing_events b
    where created_at >= since
    group by 1, 2
  ),
  redrawn as (
    select to_char(created_at at time zone 'Europe/Stockholm', 'YYYY-MM') as month,
           g.owner_id, count(*) as generations
    from public.generation_events g
    where created_at >= since
    group by 1, 2
  )
  select coalesce(billed.month, redrawn.month),
         coalesce(billed.owner_id, redrawn.owner_id),
         coalesce(billed.plans, 0),
         coalesce(billed.billed_ore, 0),
         coalesce(redrawn.generations, 0)
  from billed
  full join redrawn on billed.month = redrawn.month and billed.owner_id = redrawn.owner_id;
$$;

-- What each realtor has stored: images and plans, and their size.
create or replace function public.dev_storage()
returns table (owner_id uuid, images bigint, bytes bigint)
language sql
stable
as $$
  select i.owner_id, count(*), coalesce(sum(i.file_size), 0)
  from public.uploaded_images i
  group by i.owner_id;
$$;

-- Only the server (service role) may call them.
revoke all on function public.dev_usage(timestamptz) from public, anon, authenticated;
revoke all on function public.dev_storage() from public, anon, authenticated;
grant execute on function public.dev_usage(timestamptz) to service_role;
grant execute on function public.dev_storage() to service_role;

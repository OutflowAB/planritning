-- Lock the public (anon) key out of everything.
--
-- Before this, the anon key embedded in the browser bundle could read every row of
-- uploaded_images and generation_reviews, write to generation_events, and sign a URL for any
-- object in the planritningar bucket. As of the accompanying code change the browser never
-- talks to Supabase directly: every read, upload and image fetch goes through /api/*, which
-- checks the signed session cookie and uses the service role on the server. The service role
-- bypasses row-level security, so enabling RLS with no anon policies removes anon access
-- without affecting the application.
--
-- Apply in the Supabase SQL editor AFTER deploying the code that stops using the anon key in
-- the browser. Verify afterwards with the anon key:
--   select count(*) from uploaded_images;   -- should fail or return 0 rows
--
-- Reversible: `alter table ... disable row level security` restores the previous state.

alter table public.uploaded_images enable row level security;
alter table public.generation_reviews enable row level security;
alter table public.generation_events enable row level security;
alter table public.floor_plan_documents enable row level security;

-- Storage: drop any policy that lets anon read or sign objects in the bucket. List existing
-- policies first, since names differ per project:
--   select policyname, cmd, roles from pg_policies where schemaname = 'storage';
-- Then for each policy granting anon on the planritningar bucket:
--   drop policy "<policyname>" on storage.objects;
-- Signed URLs are no longer created by the browser, so no anon storage policy is needed.

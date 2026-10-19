-- RoomPlan's own data and a summary of the LiDAR mesh, kept with a scanned plan only for looking
-- into a scan that came out wrong. Never read back by the app, and removed with the plan (the
-- document row cascades). The app stores it best-effort and keeps working before this has run.

alter table public.floor_plan_documents
  add column if not exists raw_scan jsonb;

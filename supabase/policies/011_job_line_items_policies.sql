alter table public.job_line_items enable row level security;

create policy "job_line_items_admin_all" on public.job_line_items
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "job_line_items_office_all" on public.job_line_items
  for all
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- Deliberately no policy at all for technicians on this table. RLS can
-- hide rows but not individual columns, and cost/markup/price must stay
-- hidden from technicians. Instead, technicians read line items through
-- get_my_job_line_items() below, which is SECURITY DEFINER (so it can
-- bypass the missing SELECT policy) and explicitly leaves cost, markup,
-- and price columns out of its return columns. Mirrors get_my_jobs() in
-- 004_jobs_policies.sql; reuses the technician_owns_job() helper from
-- 001_helper_function.sql.
-- CREATE OR REPLACE cannot change an existing function's return columns
-- (Postgres error: "cannot change return type of existing function"),
-- so the old version has to be dropped first.
drop function if exists public.get_my_job_line_items(uuid);

create or replace function public.get_my_job_line_items(target_job_id uuid)
returns table (
  id uuid,
  job_id uuid,
  qty numeric,
  item_name_snapshot text,
  applied_bundle_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select id, job_id, qty, item_name_snapshot, applied_bundle_id
  from public.job_line_items
  where job_id = target_job_id
    and public.technician_owns_job(target_job_id);
$$;

comment on function public.get_my_job_line_items(uuid) is 'Returns qty, item name, and applied_bundle_id (no cost/markup/price) for a job''s line items, restricted to jobs assigned to the calling technician via technician_owns_job(). applied_bundle_id lets the UI group technician-visible lines the same way as staff, paired with get_my_job_applied_bundles() for the group names.';

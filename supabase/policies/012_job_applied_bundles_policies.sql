alter table public.job_applied_bundles enable row level security;

create policy "job_applied_bundles_admin_all" on public.job_applied_bundles
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "job_applied_bundles_office_all" on public.job_applied_bundles
  for all
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default -- same as bundles,
-- bundle_items, and materials_catalog.

-- Technicians have no SELECT policy on job_applied_bundles (same
-- reasoning as job_line_items -- deny by default). They read bundle
-- group names for their assigned jobs through this SECURITY DEFINER
-- function instead, mirroring get_my_job_line_items() exactly, just
-- for the header table.
create or replace function public.get_my_job_applied_bundles(target_job_id uuid)
returns table (
  id uuid,
  bundle_name_snapshot text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, bundle_name_snapshot
  from public.job_applied_bundles
  where job_id = target_job_id
    and public.technician_owns_job(target_job_id);
$$;

comment on function public.get_my_job_applied_bundles(uuid) is 'Returns id and bundle_name_snapshot only, restricted to jobs assigned to the calling technician via technician_owns_job(). Pairs with get_my_job_line_items() so technicians can render the same grouped view as staff without any access to cost/markup/price.';

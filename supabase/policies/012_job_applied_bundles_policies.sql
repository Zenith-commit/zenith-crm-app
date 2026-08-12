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

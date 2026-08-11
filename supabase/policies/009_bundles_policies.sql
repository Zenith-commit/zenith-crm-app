alter table public.bundles enable row level security;

create policy "bundles_admin_all" on public.bundles
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "bundles_office_all" on public.bundles
  for all
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default -- technicians get zero
-- rows back, same as materials_catalog.

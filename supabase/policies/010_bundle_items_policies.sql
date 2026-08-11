alter table public.bundle_items enable row level security;

create policy "bundle_items_admin_all" on public.bundle_items
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "bundle_items_office_all" on public.bundle_items
  for all
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default -- technicians get zero
-- rows back, same as materials_catalog and bundles.

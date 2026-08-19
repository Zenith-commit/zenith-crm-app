alter table public.materials_catalog enable row level security;

create policy "materials_catalog_admin_all" on public.materials_catalog
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "materials_catalog_office_select" on public.materials_catalog
  for select
  using (public.current_app_role() = 'office');

create policy "materials_catalog_office_insert" on public.materials_catalog
  for insert
  with check (public.current_app_role() = 'office');

create policy "materials_catalog_office_update" on public.materials_catalog
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No office delete policy (office cannot delete data, per spec).
-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default -- technicians get zero
-- rows back, same as job_costs.

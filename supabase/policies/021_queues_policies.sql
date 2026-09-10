alter table public.queues enable row level security;

create policy "queues_admin_all" on public.queues
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "queues_office_select" on public.queues
  for select
  using (public.current_app_role() = 'office');

create policy "queues_office_insert" on public.queues
  for insert
  with check (public.current_app_role() = 'office');

create policy "queues_office_update" on public.queues
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

create policy "queues_office_delete" on public.queues
  for delete
  using (public.current_app_role() = 'office');

-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default -- technicians get zero
-- rows back, same as materials_catalog/bundles.

alter table public.communications enable row level security;

create policy "communications_admin_all" on public.communications
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "communications_office_select" on public.communications
  for select
  using (public.current_app_role() = 'office');

create policy "communications_office_insert" on public.communications
  for insert
  with check (public.current_app_role() = 'office');

create policy "communications_office_update" on public.communications
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No technician policy: nothing to show them yet, and this table's
-- real shape (and who should see it) gets decided in week 2.

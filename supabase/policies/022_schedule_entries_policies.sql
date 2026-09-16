alter table public.schedule_entries enable row level security;

create policy "schedule_entries_admin_all" on public.schedule_entries
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "schedule_entries_office_select" on public.schedule_entries
  for select
  using (public.current_app_role() = 'office');

create policy "schedule_entries_office_insert" on public.schedule_entries
  for insert
  with check (public.current_app_role() = 'office');

create policy "schedule_entries_office_update" on public.schedule_entries
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

create policy "schedule_entries_office_delete" on public.schedule_entries
  for delete
  using (public.current_app_role() = 'office');

-- Technicians: confirmed entries for themselves only. Deliberately a
-- direct check, not routed through technician_owns_job() -- that helper
-- is extended in Task 5 to read this very table, and routing through it
-- here would be circular.
create policy "schedule_entries_technician_select" on public.schedule_entries
  for select
  using (
    public.current_app_role() = 'technician'
    and status = 'confirmed'
    and technician_id = auth.uid()
  );

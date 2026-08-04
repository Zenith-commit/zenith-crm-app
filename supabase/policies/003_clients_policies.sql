alter table public.clients enable row level security;

create policy "clients_admin_all" on public.clients
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "clients_office_select" on public.clients
  for select
  using (public.current_app_role() = 'office');

create policy "clients_office_insert" on public.clients
  for insert
  with check (public.current_app_role() = 'office');

create policy "clients_office_update" on public.clients
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- Technicians can see only clients tied to a job assigned to them
create policy "clients_technician_select" on public.clients
  for select
  using (
    public.current_app_role() = 'technician'
    and exists (
      select 1 from public.jobs
      where jobs.client_id = clients.id
        and jobs.assigned_to = auth.uid()
    )
  );

-- No office delete policy (office cannot delete data, per spec).
-- No technician insert/update/delete (read-only for technicians).

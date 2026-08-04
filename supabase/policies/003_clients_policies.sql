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

-- Technicians can see only clients tied to a job assigned to them.
-- Uses technician_has_job_for_client() rather than querying
-- public.jobs directly here -- a direct subquery would be blocked by
-- jobs' own RLS, since technicians have no SELECT policy on jobs.
create policy "clients_technician_select" on public.clients
  for select
  using (
    public.current_app_role() = 'technician'
    and public.technician_has_job_for_client(clients.id)
  );

-- No office delete policy (office cannot delete data, per spec).
-- No technician insert/update/delete (read-only for technicians).

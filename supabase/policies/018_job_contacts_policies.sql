alter table public.job_contacts enable row level security;

create policy "job_contacts_admin_all" on public.job_contacts
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "job_contacts_office_select" on public.job_contacts
  for select
  using (public.current_app_role() = 'office');

create policy "job_contacts_office_insert" on public.job_contacts
  for insert
  with check (public.current_app_role() = 'office');

create policy "job_contacts_office_update" on public.job_contacts
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

create policy "job_contacts_office_delete" on public.job_contacts
  for delete
  using (public.current_app_role() = 'office');

-- Technicians can view the job contact for jobs assigned to them --
-- same technician_owns_job() pattern as job_diary_technician_select --
-- but cannot create, edit, or clear it.
create policy "job_contacts_technician_select" on public.job_contacts
  for select
  using (
    public.current_app_role() = 'technician'
    and public.technician_owns_job(job_contacts.job_id)
  );

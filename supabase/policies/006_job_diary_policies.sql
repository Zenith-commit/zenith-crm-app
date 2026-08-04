alter table public.job_diary enable row level security;

create policy "job_diary_admin_all" on public.job_diary
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "job_diary_office_select" on public.job_diary
  for select
  using (public.current_app_role() = 'office');

create policy "job_diary_office_insert" on public.job_diary
  for insert
  with check (public.current_app_role() = 'office');

create policy "job_diary_office_update" on public.job_diary
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- Technicians can see diary entries on jobs assigned to them...
create policy "job_diary_technician_select" on public.job_diary
  for select
  using (
    public.current_app_role() = 'technician'
    and exists (
      select 1 from public.jobs
      where jobs.id = job_diary.job_id
        and jobs.assigned_to = auth.uid()
    )
  );

-- ...and can add new entries to those jobs, but the entry must be
-- attributed to themselves. No update/delete policy for technicians:
-- once submitted, an entry is a permanent part of the job's audit
-- trail (matches the "insert-only" pattern used for costs).
create policy "job_diary_technician_insert" on public.job_diary
  for insert
  with check (
    public.current_app_role() = 'technician'
    and created_by = auth.uid()
    and exists (
      select 1 from public.jobs
      where jobs.id = job_diary.job_id
        and jobs.assigned_to = auth.uid()
    )
  );

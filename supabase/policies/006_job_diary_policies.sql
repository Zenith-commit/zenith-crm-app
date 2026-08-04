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

-- Technicians can see diary entries on jobs assigned to them. Uses
-- technician_owns_job() rather than querying public.jobs directly --
-- a direct subquery would be blocked by jobs' own RLS, since
-- technicians have no SELECT policy on jobs.
create policy "job_diary_technician_select" on public.job_diary
  for select
  using (
    public.current_app_role() = 'technician'
    and public.technician_owns_job(job_diary.job_id)
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
    and public.technician_owns_job(job_diary.job_id)
  );

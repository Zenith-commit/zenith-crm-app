-- 2026-09-23_drop_jobs_assigned_to.sql
-- Removes jobs.assigned_to entirely. Client's ask (ServiceM8 has no
-- separate assignment field -- technician connection to a job is
-- represented purely through schedule_entries). The frontend write path
-- (JobForm's "Assigned Technician" dropdown) and the display path (Jobs
-- list / JobDetail / ClientDetail "Assigned To") were already switched to
-- a schedule_entries-derived value in the prior commit; the sizing query
-- below confirmed zero jobs currently depend on assigned_to for
-- technician access, so no data backfill is needed before dropping the
-- column:
--
--   select j.id, j.job_number, j.status, j.assigned_to
--   from public.jobs j
--   where j.assigned_to is not null
--     and not exists (
--       select 1 from public.schedule_entries se
--       where se.job_id = j.id and se.technician_id = j.assigned_to and se.status = 'confirmed'
--     );
--   -- returned 0 rows, confirmed live 2026-09-23.
--
-- Functions are updated first (so no live function body can reference a
-- column that no longer exists), then the column itself is dropped, which
-- also drops the jobs_assigned_to_fkey constraint. Same signatures as
-- before in all three functions, so create or replace is safe.

create or replace function public.technician_owns_job(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.schedule_entries
    where job_id = target_job_id
      and technician_id = auth.uid()
      and status = 'confirmed'
  );
$$;

comment on function public.technician_owns_job(uuid) is 'Whether the calling technician has a confirmed schedule_entries row for the given job. jobs.assigned_to was dropped 2026-09-23 -- a confirmed schedule entry is now the only access path.';

create or replace function public.technician_has_job_for_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs j
    join public.schedule_entries se on se.job_id = j.id
    where j.client_id = target_client_id
      and se.technician_id = auth.uid()
      and se.status = 'confirmed'
  );
$$;

comment on function public.technician_has_job_for_client(uuid) is 'Whether the calling technician has a confirmed schedule entry for any job belonging to the given client. jobs.assigned_to was dropped 2026-09-23.';

create or replace function public.get_my_jobs()
returns table (
  id uuid,
  job_number integer,
  client_id uuid,
  status public.job_status,
  description text,
  site_address text,
  created_at timestamptz,
  updated_at timestamptz,
  next_scheduled_date date,
  next_scheduled_start_time time,
  additional_scheduled_days integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    j.id, j.job_number, j.client_id, j.status, j.description, j.site_address, j.created_at, j.updated_at,
    next_entry.scheduled_date,
    next_entry.start_time,
    coalesce(other_count.cnt, 0)
  from public.jobs j
  left join lateral (
    select se.scheduled_date, se.start_time
    from public.schedule_entries se
    where se.job_id = j.id and se.status = 'confirmed'
    order by se.scheduled_date asc, se.start_time asc
    limit 1
  ) next_entry on true
  left join lateral (
    select greatest(count(*) - 1, 0) as cnt
    from public.schedule_entries se2
    where se2.job_id = j.id and se2.status = 'confirmed'
  ) other_count on true
  where exists (
    select 1 from public.schedule_entries se3
    where se3.job_id = j.id and se3.technician_id = auth.uid() and se3.status = 'confirmed'
  );
$$;

comment on function public.get_my_jobs() is 'Returns the calling technician''s jobs via a confirmed schedule_entries row (jobs.assigned_to was dropped 2026-09-23, see CLAUDE.md) -- including job_number, site_address, and the soonest confirmed date/time plus a count of any additional confirmed days, without quoted_price/job_type (both dropped earlier) or invoiced status.';

alter table public.jobs drop column assigned_to;

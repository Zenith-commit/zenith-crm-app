alter table public.jobs enable row level security;

create policy "jobs_admin_all" on public.jobs
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "jobs_office_select" on public.jobs
  for select
  using (public.current_app_role() = 'office');

create policy "jobs_office_insert" on public.jobs
  for insert
  with check (public.current_app_role() = 'office');

create policy "jobs_office_update" on public.jobs
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- Deliberately no SELECT policy for technicians on this table. RLS can
-- hide rows but not individual columns -- originally this protected
-- quoted_price specifically; that column was later dropped entirely
-- (superseded by job_line_items-based billing), but the same
-- column-hiding pattern is kept since it's still how technicians read
-- every other job field safely, and there's no reason to open direct
-- table access now that the original reason is gone. Instead,
-- technicians read their jobs through get_my_jobs() below, which is
-- SECURITY DEFINER (so it can bypass the missing SELECT policy).
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

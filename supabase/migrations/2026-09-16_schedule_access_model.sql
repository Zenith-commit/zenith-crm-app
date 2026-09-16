-- Extends the technician access model so a confirmed schedule_entries row
-- grants job/client access the same way jobs.assigned_to already does,
-- and adds scheduling columns to get_my_jobs(). Run against the live
-- database in the same order as the three statements below: the two
-- create-or-replace calls are safe to run as-is (signature unchanged),
-- but get_my_jobs() changes its return columns, so it must be dropped
-- before being recreated.

create or replace function public.technician_owns_job(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs
    where id = target_job_id
      and assigned_to = auth.uid()
  )
  or exists (
    select 1 from public.schedule_entries
    where job_id = target_job_id
      and technician_id = auth.uid()
      and status = 'confirmed'
  );
$$;

create or replace function public.technician_has_job_for_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs
    where client_id = target_client_id
      and assigned_to = auth.uid()
  )
  or exists (
    select 1 from public.jobs j
    join public.schedule_entries se on se.job_id = j.id
    where j.client_id = target_client_id
      and se.technician_id = auth.uid()
      and se.status = 'confirmed'
  );
$$;

drop function public.get_my_jobs();

create function public.get_my_jobs()
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
  where j.assigned_to = auth.uid()
     or exists (
       select 1 from public.schedule_entries se3
       where se3.job_id = j.id and se3.technician_id = auth.uid() and se3.status = 'confirmed'
     );
$$;

comment on function public.get_my_jobs() is 'Returns the calling technician''s assigned jobs -- via jobs.assigned_to or a confirmed schedule_entries row -- including job_number, site_address, and the soonest confirmed date/time plus a count of any additional confirmed days, without quoted_price/job_type (both dropped from the table) or invoiced status.';

-- Looks up the calling user's role. SECURITY DEFINER so it can read
-- public.users even though users' own RLS policy (below) wouldn't
-- otherwise let every table's policies query it directly.
-- Named current_app_role (not current_role) to avoid clashing with
-- Postgres's own built-in CURRENT_ROLE.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

-- Whether the given job is assigned to the calling technician, either
-- directly (jobs.assigned_to) or via a confirmed schedule_entries row --
-- the second path covers a technician scheduled for part of a multi-day,
-- multi-technician job who isn't the job's single assigned_to value.
-- SECURITY DEFINER so it can read public.jobs even though technicians
-- have no direct SELECT policy on that table (jobs policies deny them
-- row access on purpose, to keep quoted_price out of reach -- see
-- 004_jobs_policies.sql). Other tables' policies (job_diary, storage)
-- use this instead of querying public.jobs directly, since a direct
-- subquery against jobs would itself be blocked by jobs' own RLS.
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

-- Whether the calling technician has any job assigned to them (directly
-- or via a confirmed schedule entry) for the given client. Same
-- reasoning as technician_owns_job() above -- clients_technician_select
-- needs this because it can't query public.jobs directly either.
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

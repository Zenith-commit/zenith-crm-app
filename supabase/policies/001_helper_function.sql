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

-- Whether the calling technician has a confirmed schedule_entries row for
-- the given job. jobs.assigned_to was dropped 2026-09-23 (see CLAUDE.md) --
-- a confirmed schedule entry is now the only access path, including the
-- case of a technician scheduled for only part of a multi-day,
-- multi-technician job.
-- SECURITY DEFINER so it can read schedule_entries even though a
-- technician's own SELECT policy on that table is scoped to rows where
-- they are the technician_id -- this needs to check on behalf of the
-- caller regardless of which job/row is being asked about. Other tables'
-- policies (job_diary, communications, job_contacts, storage) use this
-- instead of querying schedule_entries directly.
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

-- Whether the calling technician has a confirmed schedule entry for any
-- job belonging to the given client. jobs.assigned_to was dropped
-- 2026-09-23 -- same reasoning as technician_owns_job() above --
-- clients_technician_select needs this because it can't query
-- public.jobs directly either.
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

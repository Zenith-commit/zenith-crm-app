-- One-off migration run manually in the Supabase SQL Editor against the
-- live project on 2026-08-07, correcting the job status pipeline to match
-- the client's actual workflow (Quote -> Work Order -> Scheduled ->
-- Completed) and separating job type/category and invoicing from status.
--
-- This file is a record of what was run live -- it is NOT part of the
-- numbered supabase/schema + supabase/policies fresh-install sequence.
-- Those files have already been updated to reflect the final schema
-- directly (003_jobs.sql, 004_jobs_policies.sql), so a fresh install
-- does not need this file at all.
--
-- Existing test job data was wiped rather than remapped (cascades to
-- job_costs, job_diary via existing on delete cascade foreign keys).

delete from public.jobs;

drop function if exists public.get_my_jobs();

alter type public.job_status rename to job_status_old;
create type public.job_status as enum ('Quote', 'Work Order', 'Scheduled', 'Completed');

alter table public.jobs alter column status drop default;
alter table public.jobs alter column status type public.job_status
  using status::text::public.job_status;
alter table public.jobs alter column status set default 'Quote';

drop type public.job_status_old;

create type public.job_type as enum ('Tile Roofing', 'Metal Roofing', 'Roof Replacement');
alter table public.jobs add column job_type public.job_type not null;

alter table public.jobs add column invoiced boolean not null default false;

create or replace function public.get_my_jobs()
returns table (
  id uuid,
  client_id uuid,
  status public.job_status,
  job_type public.job_type,
  description text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select id, client_id, status, job_type, description, created_at, updated_at
  from public.jobs
  where assigned_to = auth.uid();
$$;

comment on function public.get_my_jobs() is 'Returns the calling technician''s assigned jobs without quoted_price or invoiced status.';

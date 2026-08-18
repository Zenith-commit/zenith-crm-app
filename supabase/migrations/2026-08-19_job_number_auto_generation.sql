-- One-off migration run manually in the Supabase SQL Editor against the
-- live project on 2026-08-19, adding an auto-generated sequential job
-- number to jobs.
--
-- Uses a dedicated sequence (not an identity column) so the 2 pre-existing
-- jobs could be backfilled deterministically in created_at order (#1
-- oldest, #2 newest) before the sequence was seeded past that max --
-- an identity column's implicit backfill order on ALTER TABLE ADD COLUMN
-- is not guaranteed to match created_at order.
--
-- job_number is stored as a plain integer; "Job #0001" zero-padded
-- display formatting happens client-side only (formatJobNumber() in
-- src/lib/jobConstants.js), keeping sort/compare numeric.
--
-- get_my_jobs() needed drop + recreate (not create or replace) since
-- adding a column to a RETURNS TABLE function changes its return type.
-- Re-verified live afterward via a technician-impersonation test.

alter table public.jobs add column job_number integer;

with ordered as (
  select id, row_number() over (order by created_at) as rn
  from public.jobs
)
update public.jobs j
set job_number = o.rn
from ordered o
where j.id = o.id;

create sequence public.jobs_job_number_seq owned by public.jobs.job_number;
select setval('public.jobs_job_number_seq', (select max(job_number) from public.jobs));
alter table public.jobs alter column job_number set default nextval('public.jobs_job_number_seq');

alter table public.jobs alter column job_number set not null;
alter table public.jobs add constraint jobs_job_number_key unique (job_number);

drop function public.get_my_jobs();

create function public.get_my_jobs()
returns table(
  id uuid,
  job_number integer,
  client_id uuid,
  status job_status,
  description text,
  site_address text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select id, job_number, client_id, status, description, site_address, created_at, updated_at
  from public.jobs
  where assigned_to = auth.uid();
$function$;

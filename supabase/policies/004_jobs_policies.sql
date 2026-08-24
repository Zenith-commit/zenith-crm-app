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
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select id, job_number, client_id, status, description, site_address, created_at, updated_at
  from public.jobs
  where assigned_to = auth.uid();
$$;

comment on function public.get_my_jobs() is 'Returns the calling technician''s assigned jobs, including job_number and site_address, without quoted_price/job_type (both dropped from the table) or invoiced status.';

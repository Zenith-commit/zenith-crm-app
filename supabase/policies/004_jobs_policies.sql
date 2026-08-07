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

-- Deliberately no SELECT policy for technicians on this table.
-- RLS can hide rows but not individual columns, and quoted_price
-- must stay hidden from technicians. Instead, technicians read their
-- jobs through get_my_jobs() below, which is SECURITY DEFINER (so it
-- can bypass the missing SELECT policy) and explicitly leaves
-- quoted_price out of its return columns.
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

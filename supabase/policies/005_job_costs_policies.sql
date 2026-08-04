alter table public.job_costs enable row level security;

create policy "job_costs_admin_all" on public.job_costs
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "job_costs_office_select" on public.job_costs
  for select
  using (public.current_app_role() = 'office');

create policy "job_costs_office_insert" on public.job_costs
  for insert
  with check (public.current_app_role() = 'office');

create policy "job_costs_office_update" on public.job_costs
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default -- technicians get zero
-- rows back, confirming the "fully hidden" decision.

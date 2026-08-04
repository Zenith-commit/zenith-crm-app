alter table public.users enable row level security;

-- Admin: full access
create policy "users_admin_all" on public.users
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- Everyone can read their own row (the app needs this to know its own role/name after login)
create policy "users_select_own" on public.users
  for select
  using (id = auth.uid());

-- Office can view the staff list (needed to assign jobs to a technician)
create policy "users_office_select_all" on public.users
  for select
  using (public.current_app_role() = 'office');

-- No insert/update/delete policy for office or technician: accounts
-- are created by admin only (via the Supabase dashboard for now).

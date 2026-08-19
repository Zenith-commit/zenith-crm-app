alter table public.bundles enable row level security;

create policy "bundles_admin_all" on public.bundles
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy "bundles_office_select" on public.bundles
  for select
  using (public.current_app_role() = 'office');

create policy "bundles_office_insert" on public.bundles
  for insert
  with check (public.current_app_role() = 'office');

create policy "bundles_office_update" on public.bundles
  for update
  using (public.current_app_role() = 'office')
  with check (public.current_app_role() = 'office');

-- No office delete policy -- only admin can hard-delete bundles (via
-- bundles_admin_all's `for all`), and even admin is blocked by the
-- job_applied_bundles.bundle_id FK restrict for any bundle with real
-- job history. See CLAUDE.md "Hard-Delete / Unarchive" entry.
-- No policy at all for technicians. With RLS enabled and no matching
-- policy, Postgres denies access by default -- technicians get zero
-- rows back, same as materials_catalog.
